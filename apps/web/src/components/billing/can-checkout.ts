import type { PaidChoice } from '@arrakit/contract'
import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'

import { type ChoiceSearch, checkoutChoice } from '#/lib/checkout-choice'
import { orpc } from '#/lib/orpc'

export async function canCheckout({
  context,
  search,
}: {
  context: { queryClient: QueryClient }
  search: ChoiceSearch
}): Promise<{ choice: PaidChoice }> {
  const choice = checkoutChoice(search)
  const me = await context.queryClient.ensureQueryData(orpc.me.get.queryOptions())
  const admin = me.role === 'owner' || me.role === 'admin'
  if (!choice || !admin) throw redirect({ to: '/app/plans' })
  return { choice }
}
