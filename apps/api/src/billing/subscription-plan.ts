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

/** What a price bills: the plan its lookup key names first, and the cycle when the next part is one. */
export interface BilledPlan {
  plan: PaidPlan
  cycle: BillingCycle | null
}

export const PRICE_KEY_PREFIX = 'arrakit_'

export const priceLookupKey = (plan: PaidPlan, cycle: BillingCycle): string =>
  `${PRICE_KEY_PREFIX}${plan}_${cycle}`

const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

export function billedPlanOf(lookupKey: string | null): BilledPlan | null {
  const [plan, cycle] = lookupKey?.split('_') ?? []
  if (!isPaidPlan(plan)) return null
  return { plan, cycle: isBillingCycle(cycle) ? cycle : null }
}

export const planOfSubscription = (status: string, lookupKey: string | null): Plan =>
  (LIVE_STATUSES.has(status) && billedPlanOf(lookupKey)?.plan) || 'free'

export function subscriptionOfLookupKey(lookupKey: string | null): PaidSubscription | null {
  const billed = billedPlanOf(lookupKey)
  return billed?.cycle ? { plan: billed.plan, cycle: billed.cycle } : null
}

/** A plan whose cycle is unknown moves to the chosen cycle of the same plan at its renewal. */
export function whenChangeApplies(
  from: BilledPlan,
  to: PaidSubscription,
): 'now' | 'renewal' | null {
  if (PLANS.indexOf(to.plan) > PLANS.indexOf(from.plan)) return 'now'
  if (to.plan === from.plan && to.cycle === from.cycle) return null
  return 'renewal'
}
