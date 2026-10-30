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
export const SOLD_PLANS = ['free', 'pro', 'team'] as const
export type SoldPlan = (typeof SOLD_PLANS)[number]

export const isPaidPlan = (value: unknown): value is PaidPlan =>
  (PAID_PLANS as readonly unknown[]).includes(value)

export const isBillingCycle = (value: unknown): value is BillingCycle =>
  (BILLING_CYCLES as readonly unknown[]).includes(value)

export interface PlanOffer {
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

/** Exact, case-sensitive match. */
export function isPlan(value: unknown): value is Plan {
  return typeof value === 'string' && (PLANS as readonly string[]).includes(value)
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

export type MetricKind = 'consumable' | 'capacity'

export const METRICS = [
  { key: 'credits', label: 'Credits', unit: 'credits', kind: 'consumable', perCurrencyUnit: 100 },
  { key: 'storage_gb', label: 'Storage', unit: 'GB', kind: 'capacity', perCurrencyUnit: 10 },
] as const
export type MetricDefinition = (typeof METRICS)[number]
export type Metric = MetricDefinition['key']
export const METRIC_KEYS: readonly Metric[] = METRICS.map((m) => m.key)
