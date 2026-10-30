import {
  METRICS,
  METRIC_KEYS,
  type Metric,
  type MetricBalance,
  type MetricSums,
  type Plan,
  type UsagePeriod,
  isMetric,
  metricAmounts,
  metricBalance,
  metricOf,
  planGrant,
  splitConsumption,
  usagePeriod,
} from '@arrakit/plans'
import { and, desc, eq, ne, sql } from 'drizzle-orm'

import { type Database, transaction } from '../connection'
import type { DataContext } from '../context'
import { DomainError } from '../errors'
import type { OrganizationId } from '../organization-id'
import { creditLedger, usageLevels } from '../schema/index'
import { organizationRow } from './index'

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
  reverse(cents: number, options: ReverseOptions): Promise<boolean>
  topUps(): Promise<TopUp[]>
}

interface ReverseOptions {
  idempotencyKey: string
  /**
   * The top-up payment being taken back. All reversals of one payment together never take back
   * more than `cents`: a partial refund followed by a full dispute reverses only what is left.
   */
  payment: { key: string; cents: number }
}

/** Thrown when a use would exceed what the organization has (mapped to HTTP 402). */
export class UsageLimitError extends DomainError {
  override name = 'UsageLimitError'

  constructor(
    readonly metric: Metric,
    readonly requested: number,
    readonly available: number,
  ) {
    const { kind, label, unit } = metricOf(metric)
    super(
      'PAYMENT_REQUIRED',
      kind === 'capacity'
        ? `${label} limit reached: this needs ${requested} ${unit} more and your organization has ${available} left. Add credits in Settings → Billing to raise it.`
        : `Not enough ${label.toLowerCase()}: this needs ${requested} ${unit} and your organization has ${available} left. Add credits in Settings → Billing.`,
      { metric, requested, available },
    )
  }
}

function wholeAtLeast(value: number, min: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`[data] ${what} must be a whole number of at least ${min}, not ${value}`)
  }
  return value
}

function keyOf(idempotencyKey: string): string {
  const key = idempotencyKey.trim()
  if (!key) throw new Error('[data] an idempotency key must not be blank')
  return key
}

interface Billing {
  plan: Plan
  period: UsagePeriod
}

interface Locked extends Billing {
  tx: Database
}

export function usageScope(ctx: DataContext, organizationId: OrganizationId): OrganizationUsage {
  const own = eq(creditLedger.organizationId, organizationId)

  async function billingOf(db: Database, lock: boolean): Promise<Billing> {
    const org = await organizationRow(db, organizationId, { lock })
    if (!org) throw new Error(`[data] organization ${organizationId} is gone`)
    return { plan: org.plan, period: usagePeriod(org.usageAnchor ?? org.createdAt, ctx.now()) }
  }

  const locked = <R>(work: (locked: Locked) => Promise<R>): Promise<R> =>
    transaction(ctx.db, async (tx) => work({ tx, ...(await billingOf(tx, true)) }))

  function ledgerSums(db: Database, { period }: Billing) {
    const inPeriod = eq(creditLedger.periodStart, period.start)
    const sumWhere = (condition: ReturnType<typeof and>) =>
      sql<string>`coalesce(sum(${creditLedger.amount}) filter (where ${condition}), 0)`
    return db
      .select({
        metric: creditLedger.metric,
        planUsed: sumWhere(
          and(eq(creditLedger.bucket, 'plan'), eq(creditLedger.reason, 'consumption'), inPeriod),
        ),
        purchased: sumWhere(eq(creditLedger.bucket, 'purchased')),
        used: sumWhere(and(eq(creditLedger.reason, 'consumption'), inPeriod)),
      })
      .from(creditLedger)
      .where(and(own, ne(creditLedger.reason, 'plan_grant')))
      .groupBy(creditLedger.metric)
  }

  function levelsOf(db: Database) {
    return db
      .select({ metric: usageLevels.metric, value: usageLevels.value })
      .from(usageLevels)
      .where(eq(usageLevels.organizationId, organizationId))
  }

  type LedgerSums = Awaited<ReturnType<typeof ledgerSums>>
  type Levels = Awaited<ReturnType<typeof levelsOf>>

  function usageFrom({ plan, period }: Billing, rows: LedgerSums, levels: Levels) {
    const grant = planGrant(plan)
    const sums = new Map<string, MetricSums>(
      rows.map((r) => [
        r.metric,
        {
          planUsed: 0 - Number(r.planUsed) || 0,
          purchased: Number(r.purchased),
          used: 0 - Number(r.used) || 0,
        },
      ]),
    )
    const levelOf = new Map(levels.map((l) => [l.metric, Number(l.value)]))
    return new Map<Metric, MetricUsage>(
      METRIC_KEYS.map((metric) => [
        metric,
        {
          ...metricBalance(
            metric,
            { ...sums.get(metric), granted: grant[metric] },
            levelOf.get(metric) ?? 0,
          ),
          resetsOn: period.end,
        },
      ]),
    )
  }

  async function currentUsage(): Promise<Map<Metric, MetricUsage>> {
    const [billing, levels] = await Promise.all([billingOf(ctx.db, false), levelsOf(ctx.db)])
    return usageFrom(billing, await ledgerSums(ctx.db, billing), levels)
  }

  async function lockedUsage(l: Locked): Promise<Map<Metric, MetricUsage>> {
    const rows = await ledgerSums(l.tx, l)
    return usageFrom(l, rows, await levelsOf(l.tx))
  }

  async function addPurchased(
    rows: { metric: Metric; amount: number; reason: 'purchase' | 'adjustment'; cents: number }[],
    idempotencyKey: string,
    db: Database,
  ): Promise<boolean> {
    if (rows.length === 0) return false
    const written = await db
      .insert(creditLedger)
      .values(
        rows.map((row) => ({
          organizationId,
          metric: row.metric,
          bucket: 'purchased' as const,
          reason: row.reason,
          amount: row.amount,
          cents: row.cents,
          idempotencyKey,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: creditLedger.id })
    return written.length > 0
  }

  function reversalRows(cents: number) {
    const amounts = metricAmounts(cents)
    return METRIC_KEYS.filter((metric) => amounts[metric] > 0).map((metric) => ({
      metric,
      amount: -amounts[metric],
      reason: 'adjustment' as const,
      cents,
    }))
  }

  return {
    async summary() {
      const usage = await currentUsage()
      return METRIC_KEYS.map((metric) => usage.get(metric)!)
    },

    async check(metric, quantity = 1) {
      wholeAtLeast(quantity, 0, 'a quantity')
      const { available } = (await currentUsage()).get(metric)!
      return { metric, allowed: quantity <= available, available, requested: quantity }
    },

    async consume(metric, quantity, { idempotencyKey }) {
      if (metricOf(metric).kind !== 'consumable') {
        throw new Error(`[data] ${metric} is a capacity metric, not consumable`)
      }
      wholeAtLeast(quantity, 1, 'a quantity')
      const key = keyOf(idempotencyKey)
      return locked(async (l) => {
        const usage = (await lockedUsage(l)).get(metric)!
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
      if (metricOf(metric).kind !== 'capacity') {
        throw new Error(`[data] ${metric} is a consumable metric, not capacity`)
      }
      wholeAtLeast(value, 0, 'a level')
      return locked(async (l) => {
        const usage = (await lockedUsage(l)).get(metric)!
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
        ctx.db,
      )
    },

    async reverse(cents, { idempotencyKey, payment }) {
      wholeAtLeast(cents, 1, 'an amount of cents')
      const key = keyOf(idempotencyKey)
      const paymentKey = keyOf(payment.key)
      const paid = wholeAtLeast(payment.cents, 1, 'a payment amount of cents')
      const prefix = `reversal-of:${encodeURIComponent(paymentKey)}:`
      const storedKey = `${prefix}${key}`
      return locked(async ({ tx }) => {
        const earlier = await tx
          .selectDistinct({ key: creditLedger.idempotencyKey, cents: creditLedger.cents })
          .from(creditLedger)
          .where(
            and(
              own,
              eq(creditLedger.reason, 'adjustment'),
              sql`starts_with(${creditLedger.idempotencyKey}, ${prefix})`,
            ),
          )
        if (earlier.some((row) => row.key === storedKey)) return false
        const reversed = earlier.reduce((total, row) => total + (row.cents ?? 0), 0)
        const take = Math.min(cents, paid - reversed)
        if (take <= 0) return false
        return addPurchased(reversalRows(take), storedKey, tx)
      })
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
