export const PLANS = ['free', 'pro', 'team', 'internal'] as const // order = rank
export type Plan = (typeof PLANS)[number]

export const PLAN_LABELS: Record<Plan, string> = {
  free: 'Free',
  pro: 'Pro',
  team: 'Team',
  internal: 'Internal',
}

export const CURRENCY = 'usd' // Stripe lowercase ISO 4217

export const BILLING_CYCLES = ['monthly', 'yearly'] as const
export type BillingCycle = (typeof BILLING_CYCLES)[number]

/** Plans that can be bought (every plan except free and internal). */
export const PAID_PLANS = ['pro', 'team'] as const
export type PaidPlan = (typeof PAID_PLANS)[number]

/** Plans shown on the pricing page (every plan except internal). */
const SOLD_PLANS = ['free', 'pro', 'team'] as const

export const isPaidPlan = (value: unknown): value is PaidPlan =>
  (PAID_PLANS as readonly unknown[]).includes(value)

export const isBillingCycle = (value: unknown): value is BillingCycle =>
  (BILLING_CYCLES as readonly unknown[]).includes(value)

interface PlanOffer {
  plan: Plan
  monthlyCents: number
  yearlyCents: number
  seats: number
  monthlyGrantCents: number
}

export const PLAN_OFFERS: Record<Plan, PlanOffer> = {
  free: { plan: 'free', monthlyCents: 0, yearlyCents: 0, seats: 1, monthlyGrantCents: 100 },
  pro: {
    plan: 'pro',
    monthlyCents: 2_000,
    yearlyCents: 19_200,
    seats: 3,
    monthlyGrantCents: 1_000,
  },
  team: {
    plan: 'team',
    monthlyCents: 5_000,
    yearlyCents: 48_000,
    seats: 10,
    monthlyGrantCents: 3_000,
  },
  internal: {
    plan: 'internal',
    monthlyCents: 0,
    yearlyCents: 0,
    seats: 100,
    monthlyGrantCents: 10_000,
  },
}

export function seatLimitMessage(plan: Plan): string {
  const seats = PLAN_OFFERS[plan].seats
  return `Your organization's ${PLAN_LABELS[plan]} plan includes ${seats} ${seats === 1 ? 'seat' : 'seats'}, all taken. Upgrade to invite more people.`
}

export function soldOffers() {
  return SOLD_PLANS.map((plan) => {
    const offer = PLAN_OFFERS[plan]
    return {
      plan,
      monthly: { amount: offer.monthlyCents, currency: CURRENCY },
      yearly: { amount: offer.yearlyCents, currency: CURRENCY },
      seats: offer.seats,
    }
  })
}

/** A top-up: any whole number of cents in [min, max]. Adds to every metric; never expires. */
export const TOP_UP = { minCents: 1_000, maxCents: 50_000 } as const

export const METRIC_KINDS = ['consumable', 'capacity'] as const
export type MetricKind = (typeof METRIC_KINDS)[number]

export const METRICS = [
  { key: 'credits', label: 'Credits', unit: 'credits', kind: 'consumable', perCurrencyUnit: 100 },
  { key: 'storage_gb', label: 'Storage', unit: 'GB', kind: 'capacity', perCurrencyUnit: 10 },
] as const
type MetricDefinition = (typeof METRICS)[number]
export type Metric = MetricDefinition['key']
export const METRIC_KEYS: readonly Metric[] = METRICS.map((m) => m.key)

export interface MetricSums {
  granted?: number
  planUsed?: number
  purchased?: number
  used?: number
}

export interface MetricBalance {
  metric: Metric
  kind: MetricKind
  granted: number
  plan: number
  purchased: number
  used: number
  available: number
  limit: number | null
}

export interface UsagePeriod {
  start: Date
  /** Exclusive. */
  end: Date
}

export function isMetric(value: unknown): value is Metric {
  return typeof value === 'string' && (METRIC_KEYS as readonly string[]).includes(value)
}

export function metricOf(metric: Metric): MetricDefinition {
  const found = METRICS.find((m) => m.key === metric)
  if (!found) throw new Error(`no metric ${String(metric)}`)
  return found
}

/** How much of `metric` `cents` buy, rounded down: $20 buys 2000 credits and 200 GB. */
function metricAmount(metric: Metric, cents: number): number {
  return Math.floor((cents * metricOf(metric).perCurrencyUnit) / 100)
}

export function metricAmounts(cents: number): Record<Metric, number> {
  return Object.fromEntries(METRIC_KEYS.map((m) => [m, metricAmount(m, cents)])) as Record<
    Metric,
    number
  >
}

/** What a plan grants every month, per metric. */
export function planGrant(plan: Plan): Record<Metric, number> {
  return metricAmounts(PLAN_OFFERS[plan].monthlyGrantCents)
}

export function isTopUpAmount(cents: unknown): cents is number {
  return (
    typeof cents === 'number' &&
    Number.isInteger(cents) &&
    cents >= TOP_UP.minCents &&
    cents <= TOP_UP.maxCents
  )
}

/** Months from `anchor` in UTC, day clamped to the month's last day (as Stripe does). */
function addMonths(anchor: Date, months: number): Date {
  const year = anchor.getUTCFullYear()
  const month = anchor.getUTCMonth() + months
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(anchor.getUTCDate(), last),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  )
}

/** The usage month containing `now`, counted from `anchor`. */
export function usagePeriod(anchor: Date, now: Date): UsagePeriod {
  if (now < anchor) return { start: anchor, end: addMonths(anchor, 1) }
  let months =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + now.getUTCMonth() - anchor.getUTCMonth()
  if (addMonths(anchor, months) > now) months -= 1
  return { start: addMonths(anchor, months), end: addMonths(anchor, months + 1) }
}

/** Plan grant first, then purchased; null when the balance does not cover `quantity`. */
export function splitConsumption(
  quantity: number,
  balance: { plan: number; purchased: number },
): { plan: number; purchased: number } | null {
  const plan = Math.max(0, balance.plan)
  const purchased = Math.max(0, balance.purchased)
  if (quantity > plan + purchased) return null
  const fromPlan = Math.min(quantity, plan)
  return { plan: fromPlan, purchased: quantity - fromPlan }
}

/** The only rule for a balance: data layer, fakes and screens all use it. */
export function metricBalance(metric: Metric, sums: MetricSums, level = 0): MetricBalance {
  const { kind } = metricOf(metric)
  const granted = sums.granted ?? 0
  const planUsed = sums.planUsed ?? 0
  const purchased = sums.purchased ?? 0
  const used = sums.used ?? 0
  if (kind === 'capacity') {
    const limit = Math.max(0, granted + purchased)
    return {
      metric,
      kind,
      granted,
      plan: granted,
      purchased,
      used: level,
      available: Math.max(0, limit - level),
      limit,
    }
  }
  const plan = Math.max(0, granted - planUsed)
  const left = Math.max(0, purchased)
  return { metric, kind, granted, plan, purchased: left, used, available: plan + left, limit: null }
}

export * from './files'
