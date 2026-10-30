import {
  METRICS,
  METRIC_KEYS,
  type Metric,
  type MetricDefinition,
  type MetricKind,
  PLAN_OFFERS,
  type Plan,
  TOP_UP,
} from './catalog'

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
export function metricAmount(metric: Metric, cents: number): number {
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
    const limit = granted + purchased
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
