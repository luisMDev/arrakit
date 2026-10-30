import type { PaidChoice } from '@arrakit/contract'
import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'

import { type ChoiceSearch, checkoutChoice } from '#/lib/checkout-choice'
import { grants } from '#/lib/current-user'
import { guardedMe } from '#/lib/guards/guarded-me'

export async function canCheckout({
  context,
  location,
  search,
}: {
  context: { queryClient: QueryClient }
  location: { href: string }
  search: ChoiceSearch
}): Promise<{ choice: PaidChoice }> {
  const me = await guardedMe(context.queryClient, location.href)
  const choice = checkoutChoice(search)
  if (!choice || !grants(me, { billing: ['manage'] })) throw redirect({ to: '/app/plans' })
  return { choice }
}
