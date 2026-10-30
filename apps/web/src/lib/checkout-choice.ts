import { BILLING_CYCLES, type BillingCycle, PAID_PLANS, type PaidPlan } from '@arrakit/plans'

export interface CheckoutChoice {
  plan: PaidPlan
  cycle: BillingCycle
}

export interface ChoiceSearch {
  plan?: string
  cycle?: string
}

/** `{ plan, cycle }` only for a paid plan and a known cycle; anything else is dropped. */
export function checkoutChoice(search: ChoiceSearch): CheckoutChoice | null {
  const plan = (PAID_PLANS as readonly string[]).includes(search.plan ?? '')
    ? (search.plan as PaidPlan)
    : null
  const cycle = (BILLING_CYCLES as readonly string[]).includes(search.cycle ?? '')
    ? (search.cycle as BillingCycle)
    : null
  return plan && cycle ? { plan, cycle } : null
}

export const choiceSearch = (search: Record<string, unknown>): ChoiceSearch => ({
  ...(typeof search.plan === 'string' ? { plan: search.plan } : {}),
  ...(typeof search.cycle === 'string' ? { cycle: search.cycle } : {}),
})

export function profileLanding(choice: CheckoutChoice | null): string {
  return choice ? `/profile?${new URLSearchParams({ ...choice })}` : '/profile'
}
