import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'

import { type ChoiceSearch, appLanding, checkoutChoice } from '#/lib/checkout-choice'

import { guardedMe } from './guarded-me'

/** Sign up and sign in are for visitors: a signed-in person goes on to Profile or the app. */
export async function skipWhenSignedIn({
  context,
  location,
  search,
}: {
  context: { queryClient: QueryClient }
  location: { href: string }
  search: ChoiceSearch
}) {
  const me = await guardedMe(context.queryClient, location.href)
  if (!me) return
  const choice = checkoutChoice(search)
  if (!me.organization) throw redirect({ to: '/profile', search: choice ?? {} })
  throw redirect(appLanding(choice))
}
