import type { QueryClient } from '@tanstack/react-query'
import { type ParsedLocation, redirect } from '@tanstack/react-router'

import { statusOf } from '#/lib/api-errors'
import { type ChoiceSearch, checkoutChoice } from '#/lib/checkout-choice'
import { orpc } from '#/lib/orpc'
import { session } from '#/lib/session'

export async function requireAccount({
  context,
  location,
  search,
}: {
  context: { queryClient: QueryClient }
  location: ParsedLocation
  search: ChoiceSearch
}) {
  let outcome: 'visitor' | 'member' | 'profile' | 'forbidden' | 'unavailable'
  try {
    if (!(await session())) outcome = 'visitor'
    else {
      const me = await context.queryClient.fetchQuery(orpc.me.get.queryOptions())
      outcome = me.organization ? 'member' : 'profile'
    }
  } catch (err) {
    const status = statusOf(err)
    if (status === 401) outcome = 'visitor'
    else {
      console.error('[requireAccount] the guard failed', err)
      outcome = status === 403 ? 'forbidden' : 'unavailable'
    }
  }
  if (outcome === 'profile') return
  if (outcome === 'visitor') throw redirect({ to: '/signup' })
  if (outcome === 'forbidden')
    throw redirect({ to: '/unavailable', search: { reason: 'forbidden' } })
  if (outcome === 'unavailable')
    throw redirect({ to: '/unavailable', search: { next: location.href } })
  const choice = checkoutChoice(search)
  throw choice ? redirect({ to: '/app/checkout', search: choice }) : redirect({ to: '/app' })
}
