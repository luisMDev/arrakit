import { type PaidChoice, paidChoiceSchema } from '@arrakit/contract'

export interface ChoiceSearch {
  plan?: string
  cycle?: string
}

/** `{ plan, cycle }` only for a paid plan and a known cycle; anything else is dropped. */
export function checkoutChoice(search: ChoiceSearch): PaidChoice | null {
  return paidChoiceSchema.safeParse(search).data ?? null
}

export const choiceSearch = (search: Record<string, unknown>): ChoiceSearch => ({
  ...(typeof search.plan === 'string' ? { plan: search.plan } : {}),
  ...(typeof search.cycle === 'string' ? { cycle: search.cycle } : {}),
})

/** Where a person with an organization starts: Checkout for a chosen plan, else Home. */
export function appLanding(choice: PaidChoice | null) {
  return choice ? { to: '/app/checkout' as const, search: choice } : { to: '/app' as const }
}

export function profileLanding(choice: PaidChoice | null): string {
  return choice ? `/profile?${new URLSearchParams({ ...choice })}` : '/profile'
}
