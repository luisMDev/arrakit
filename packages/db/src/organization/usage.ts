import {
  METRICS,
  METRIC_KEYS,
  type Metric,
  type MetricBalance,
  type MetricKind,
  type MetricSums,
  type UsagePeriod,
  isMetric,
  metricAmounts,
  metricBalance,
  metricOf,
  planGrant,
  splitConsumption,
  usagePeriod,
} from '@arrakit/plans'
import { and, desc, eq, sql } from 'drizzle-orm'

import type { Database } from '../connection'
import type { DataContext } from '../context'
import type { OrganizationId } from '../organization-id'
import { creditLedger, organizations, usageLevels } from '../schema/index'

export type { MetricBalance } from '@arrakit/plans'

export interface MetricUsage extends MetricBalance {
  /** End of the current usage period (exclusive). */
  resetsOn: Date
}

export interface UsageVerdict {
  metric: Metric
  allowed: boolean
  available: number
  requested: number
}

export interface TopUp {
  at: Date
  cents: number
  amounts: Partial<Record<Metric, number>>
}

export interface OrganizationUsage {
  summary(): Promise<MetricUsage[]>
  check(metric: Metric, quantity?: number): Promise<UsageVerdict>
  consume(
    metric: Metric,
    quantity: number,
    options: { idempotencyKey: string },
  ): Promise<MetricUsage>
  set(metric: Metric, value: number): Promise<MetricUsage>
  credit(cents: number, options: { idempotencyKey: string }): Promise<boolean>
  reverse(cents: number, options: { idempotencyKey: string }): Promise<boolean>
  adjust(metric: Metric, amount: number, options: { idempotencyKey: string }): Promise<boolean>
  topUps(): Promise<TopUp[]>
}

/** Thrown when a use would exceed what the organization has (mapped to HTTP 402). */
export class UsageLimitError extends Error {
  override name = 'UsageLimitError'
  readonly kind: MetricKind

  constructor(
    readonly metric: Metric,
    readonly requested: number,
    readonly available: number,
  ) {
    const { kind, label, unit } = metricOf(metric)
    super(
      kind === 'capacity'
        ? `${label} limit reached: this needs ${requested} ${unit} more and your organization has ${available} left. Add credits in Settings → Billing to raise it.`
        : `Not enough ${label.toLowerCase()}: this needs ${requested} ${unit} and your organization has ${available} left. Add credits in Settings → Billing.`,
    )
    this.kind = kind
  }
}

function knownMetric(metric: Metric): Metric {
  if (!isMetric(metric)) throw new Error(`[data] no metric ${String(metric)} in METRICS`)
  return metric
}

function wholeAtLeast(value: number, min: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`[data] ${what} must be a whole number of at least ${min}, not ${value}`)
  }
  return value
}

function keyOf(idempotencyKey: string): string {
  const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : ''
  if (!key) throw new Error('[data] an idempotency key must not be blank')
  return key
}

interface Locked {
  tx: Database
  period: UsagePeriod
}

export function usageScope(ctx: DataContext, organizationId: OrganizationId): OrganizationUsage {
  const own = eq(creditLedger.organizationId, organizationId)

  async function locked<R>(work: (locked: Locked) => Promise<R>): Promise<R> {
    return ctx.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database
      const [org] = await tx
        .select({
          plan: organizations.plan,
          createdAt: organizations.createdAt,
          usageAnchor: organizations.usageAnchor,
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .for('no key update')
      if (!org) throw new Error(`[data] organization ${organizationId} is gone`)

      const period = usagePeriod(org.usageAnchor ?? org.createdAt, ctx.now())
      const grantedRows = await tx
        .select({
          metric: creditLedger.metric,
          granted: sql<string>`coalesce(sum(${creditLedger.amount}), 0)`,
        })
        .from(creditLedger)
        .where(
          and(
            own,
            eq(creditLedger.reason, 'plan_grant'),
            eq(creditLedger.periodStart, period.start),
          ),
        )
        .groupBy(creditLedger.metric)
      const grantedSoFar = new Map(grantedRows.map((r) => [r.metric, Number(r.granted)]))
      const grant = planGrant(org.plan)
      const owed = METRIC_KEYS.map((metric) => ({
        metric,
        amount: grant[metric] - (grantedSoFar.get(metric) ?? 0),
      })).filter((g) => g.amount > 0)
      if (owed.length > 0) {
        await tx
          .insert(creditLedger)
          .values(
            owed.map(({ metric, amount }) => ({
              organizationId,
              metric,
              bucket: 'plan' as const,
              reason: 'plan_grant' as const,
              amount,
              periodStart: period.start,
              idempotencyKey: `grant:${period.start.toISOString()}:${org.plan}`,
            })),
          )
          .onConflictDoNothing()
      }
      return work({ tx, period })
    })
  }

  async function usageOf({ tx, period }: Locked): Promise<Map<Metric, MetricUsage>> {
    const inPeriod = eq(creditLedger.periodStart, period.start)
    const sumWhere = (condition: ReturnType<typeof and>) =>
      sql<string>`coalesce(sum(${creditLedger.amount}) filter (where ${condition}), 0)`
    const rows = await tx
      .select({
        metric: creditLedger.metric,
        granted: sumWhere(and(eq(creditLedger.reason, 'plan_grant'), inPeriod)),
        planUsed: sumWhere(
          and(eq(creditLedger.bucket, 'plan'), eq(creditLedger.reason, 'consumption'), inPeriod),
        ),
        purchased: sumWhere(eq(creditLedger.bucket, 'purchased')),
        used: sumWhere(and(eq(creditLedger.reason, 'consumption'), inPeriod)),
      })
      .from(creditLedger)
      .where(own)
      .groupBy(creditLedger.metric)
    const levels = await tx
      .select({ metric: usageLevels.metric, value: usageLevels.value })
      .from(usageLevels)
      .where(eq(usageLevels.organizationId, organizationId))

    const sums = new Map<string, MetricSums>(
      rows.map((r) => [
        r.metric,
        {
          granted: Number(r.granted),
          planUsed: 0 - Number(r.planUsed) || 0,
          purchased: Number(r.purchased),
          used: 0 - Number(r.used) || 0,
        },
      ]),
    )
    const levelOf = new Map(levels.map((l) => [l.metric, Number(l.value)]))
    return new Map(
      METRIC_KEYS.map((metric) => [
        metric,
        {
          ...metricBalance(metric, sums.get(metric) ?? {}, levelOf.get(metric) ?? 0),
          resetsOn: period.end,
        },
      ]),
    )
  }

  async function addPurchased(
    rows: { metric: Metric; amount: number; reason: 'purchase' | 'adjustment'; cents?: number }[],
    idempotencyKey: string,
  ): Promise<boolean> {
    if (rows.length === 0) return false
    const written = await ctx.db
      .insert(creditLedger)
      .values(
        rows.map((row) => ({
          organizationId,
          metric: row.metric,
          bucket: 'purchased' as const,
          reason: row.reason,
          amount: row.amount,
          cents: row.cents ?? null,
          idempotencyKey,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: creditLedger.id })
    return written.length > 0
  }

  return {
    summary: () =>
      locked(async (l) => {
        const usage = await usageOf(l)
        return METRIC_KEYS.map((metric) => usage.get(metric)!)
      }),

    async check(metric, quantity = 1) {
      knownMetric(metric)
      wholeAtLeast(quantity, 0, 'a quantity')
      return locked(async (l) => {
        const { available } = (await usageOf(l)).get(metric)!
        return { metric, allowed: quantity <= available, available, requested: quantity }
      })
    },

    async consume(metric, quantity, { idempotencyKey }) {
      knownMetric(metric)
      if (metricOf(metric).kind !== 'consumable') {
        throw new Error(`[data] ${metric} is a capacity metric, not consumable`)
      }
      wholeAtLeast(quantity, 1, 'a quantity')
      const key = keyOf(idempotencyKey)
      return locked(async (l) => {
        const usage = (await usageOf(l)).get(metric)!
        const [existing] = await l.tx
          .select({ id: creditLedger.id })
          .from(creditLedger)
          .where(
            and(
              own,
              eq(creditLedger.metric, metric),
              eq(creditLedger.reason, 'consumption'),
              eq(creditLedger.idempotencyKey, key),
            ),
          )
          .limit(1)
        if (existing) return usage

        const split = splitConsumption(quantity, usage)
        if (!split) throw new UsageLimitError(metric, quantity, usage.available)
        const parts = (['plan', 'purchased'] as const).filter((bucket) => split[bucket] > 0)
        await l.tx.insert(creditLedger).values(
          parts.map((bucket) => ({
            organizationId,
            metric,
            bucket,
            reason: 'consumption' as const,
            amount: -split[bucket],
            periodStart: l.period.start,
            idempotencyKey: key,
          })),
        )
        const plan = usage.plan - split.plan
        const purchased = usage.purchased - split.purchased
        return {
          ...usage,
          plan,
          purchased,
          used: usage.used + quantity,
          available: plan + purchased,
        }
      })
    },

    async set(metric, value) {
      knownMetric(metric)
      if (metricOf(metric).kind !== 'capacity') {
        throw new Error(`[data] ${metric} is a consumable metric, not capacity`)
      }
      wholeAtLeast(value, 0, 'a level')
      return locked(async (l) => {
        const usage = (await usageOf(l)).get(metric)!
        const limit = usage.limit ?? 0
        if (value > usage.used && value > limit) {
          throw new UsageLimitError(metric, value - usage.used, usage.available)
        }
        await l.tx
          .insert(usageLevels)
          .values({ organizationId, metric, value })
          .onConflictDoUpdate({
            target: [usageLevels.organizationId, usageLevels.metric],
            set: { value, updatedAt: sql`now()` },
          })
        return { ...usage, used: value, available: Math.max(0, limit - value) }
      })
    },

    async credit(cents, { idempotencyKey }) {
      wholeAtLeast(cents, 1, 'an amount of cents')
      const key = keyOf(idempotencyKey)
      const amounts = metricAmounts(cents)
      return addPurchased(
        METRIC_KEYS.map((metric) => ({
          metric,
          amount: amounts[metric],
          reason: 'purchase' as const,
          cents,
        })),
        key,
      )
    },

    async reverse(cents, { idempotencyKey }) {
      wholeAtLeast(cents, 1, 'an amount of cents')
      const key = keyOf(idempotencyKey)
      const amounts = metricAmounts(cents)
      return addPurchased(
        METRIC_KEYS.filter((metric) => amounts[metric] > 0).map((metric) => ({
          metric,
          amount: -amounts[metric],
          reason: 'adjustment' as const,
        })),
        key,
      )
    },

    async adjust(metric, amount, { idempotencyKey }) {
      knownMetric(metric)
      if (!Number.isSafeInteger(amount) || amount === 0) {
        throw new Error(`[data] an adjustment must be a whole number other than 0, not ${amount}`)
      }
      const key = keyOf(idempotencyKey)
      return addPurchased([{ metric, amount, reason: 'adjustment' }], key)
    },

    async topUps() {
      const rows = await ctx.db
        .select({
          metric: creditLedger.metric,
          amount: creditLedger.amount,
          cents: creditLedger.cents,
          key: creditLedger.idempotencyKey,
          at: creditLedger.createdAt,
        })
        .from(creditLedger)
        .where(and(own, eq(creditLedger.reason, 'purchase')))
        .orderBy(desc(creditLedger.createdAt), creditLedger.idempotencyKey)
      const byKey = new Map<string, TopUp>()
      for (const row of rows) {
        let topUp = byKey.get(row.key)
        if (!topUp) {
          topUp = { at: row.at, cents: row.cents ?? 0, amounts: {} }
          byKey.set(row.key, topUp)
        }
        if (isMetric(row.metric)) topUp.amounts[row.metric] = Number(row.amount)
      }
      return [...byKey.values()].map((topUp) => ({
        ...topUp,
        amounts: Object.fromEntries(
          METRICS.filter((m) => m.key in topUp.amounts).map((m) => [m.key, topUp.amounts[m.key]]),
        ),
      }))
    },
  }
}
