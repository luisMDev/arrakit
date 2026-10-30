import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'

import { type ChoiceSearch, appLanding, checkoutChoice } from '#/lib/checkout-choice'

import { guardedMe } from './guarded-me'

/** Profile is for a signed-in person without an organization. */
export async function requireAccount({
  context,
  location,
  search,
}: {
  context: { queryClient: QueryClient }
  location: { href: string }
  search: ChoiceSearch
}) {
  const me = await guardedMe(context.queryClient, location.href)
  if (!me) throw redirect({ to: '/signup' })
  if (me.organization) throw redirect(appLanding(checkoutChoice(search)))
}
