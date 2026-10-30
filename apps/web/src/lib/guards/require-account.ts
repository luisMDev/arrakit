import type { Me } from '@arrakit/contract'
import type { QueryClient } from '@tanstack/react-query'
import { type ParsedLocation, redirect } from '@tanstack/react-router'

import { type ChoiceSearch, checkoutChoice } from '#/lib/checkout-choice'
import { orpc } from '#/lib/orpc'

import { guardFailure, unavailableRedirect } from './guard-failure'

export async function requireAccount({
  context,
  location,
  search,
}: {
  context: { queryClient: QueryClient }
  location: ParsedLocation
  search: ChoiceSearch
}) {
  let me: Me
  try {
    me = await context.queryClient.fetchQuery(orpc.me.get.queryOptions())
  } catch (err) {
    const failure = guardFailure('[requireAccount] the guard failed', err)
    if (failure === 'signed-out') throw redirect({ to: '/signup' })
    throw unavailableRedirect(failure, location.href)
  }
  if (!me.organization) return
  const choice = checkoutChoice(search)
  throw choice ? redirect({ to: '/app/checkout', search: choice }) : redirect({ to: '/app' })
}
