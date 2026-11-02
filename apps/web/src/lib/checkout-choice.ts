import { type PaidChoice, paidChoiceSchema } from '@arrakit/contract'
import { z } from 'zod'

import { searchText } from '#/lib/search-params'

export const choiceSearch = z.object({ plan: searchText, cycle: searchText })
export type ChoiceSearch = z.infer<typeof choiceSearch>

/** `{ plan, cycle }` only for a paid plan and a known cycle; anything else is dropped. */
export function checkoutChoice(search: ChoiceSearch): PaidChoice | null {
  return paidChoiceSchema.safeParse(search).data ?? null
}

/** Where a person with an organization starts: Checkout for a chosen plan, else Home. */
export function appLanding(choice: PaidChoice | null) {
  return choice ? { to: '/app/checkout' as const, search: choice } : { to: '/app' as const }
}

export function profileLanding(choice: PaidChoice | null): string {
  return choice ? `/profile?${new URLSearchParams({ ...choice })}` : '/profile'
}
