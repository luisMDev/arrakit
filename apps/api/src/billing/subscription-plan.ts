import {
  type BillingCycle,
  PLANS,
  type PaidPlan,
  type Plan,
  isBillingCycle,
  isPaidPlan,
} from '@arrakit/plans'

export interface PaidSubscription {
  plan: PaidPlan
  cycle: BillingCycle
}

export const PRICE_KEY_PREFIX = 'arrakit_'

export const priceLookupKey = (plan: PaidPlan, cycle: BillingCycle): string =>
  `${PRICE_KEY_PREFIX}${plan}_${cycle}`

const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

export function planOfSubscription(status: string, lookupKey: string | null): Plan {
  if (!LIVE_STATUSES.has(status)) return 'free'
  const plan = lookupKey?.split('_')[0]
  return isPaidPlan(plan) ? plan : 'free'
}

export function subscriptionOfLookupKey(lookupKey: string | null): PaidSubscription | null {
  const [plan, cycle, ...rest] = lookupKey?.split('_') ?? []
  if (rest.length > 0) return null
  return isPaidPlan(plan) && isBillingCycle(cycle) ? { plan, cycle } : null
}

export function whenChangeApplies(
  from: PaidSubscription,
  to: PaidSubscription,
): 'now' | 'renewal' | null {
  if (PLANS.indexOf(to.plan) > PLANS.indexOf(from.plan)) return 'now'
  if (to.plan === from.plan && to.cycle === from.cycle) return null
  return 'renewal'
}
