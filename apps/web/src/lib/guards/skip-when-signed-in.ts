import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'

import { tr } from '#/i18n'
import { statusOf } from '#/lib/api-errors'
import { type ChoiceSearch, checkoutChoice } from '#/lib/checkout-choice'
import { notify } from '#/lib/notify'
import { orpc } from '#/lib/orpc'

import { guardFailure } from './guard-failure'

const FETCH_FAILURE =
  /failed to fetch|fetch failed|networkerror|network request failed|load failed/i

/** A fetch that got no answer rejects with a TypeError whose message names the network. */
function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError && FETCH_FAILURE.test(err.message)) return true
  return err instanceof Error && err.cause !== undefined && isNetworkFailure(err.cause)
}

/** Only no answer at all or a server error blames the connection; a bug never does. */
function isUnreachable(err: unknown): boolean {
  return statusOf(err) >= 500 || isNetworkFailure(err)
}

export async function skipWhenSignedIn({
  context,
  search,
  cause,
}: {
  context: { queryClient: QueryClient }
  search: ChoiceSearch
  cause?: 'preload' | 'enter' | 'stay'
}) {
  let hasOrganization: boolean
  try {
    const me = await context.queryClient.fetchQuery(orpc.me.get.queryOptions())
    hasOrganization = me.organization !== null
  } catch (err) {
    if (guardFailure('[skipWhenSignedIn] the guard failed', err) === 'signed-out') return
    if (cause === 'preload') return
    notify.error(tr(isUnreachable(err) ? 'onboarding.unreachable' : 'onboarding.failed'))
    return
  }
  const choice = checkoutChoice(search)
  if (!hasOrganization) throw redirect({ to: '/profile', search: choice ?? {} })
  if (choice) throw redirect({ to: '/app/checkout', search: choice })
  throw redirect({ to: '/app' })
}
