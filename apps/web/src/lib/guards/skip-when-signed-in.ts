import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import { toast } from 'sonner'

import { tr } from '#/i18n'
import { statusOf } from '#/lib/api-errors'
import { type ChoiceSearch, checkoutChoice } from '#/lib/checkout-choice'
import { orpc } from '#/lib/orpc'
import { session } from '#/lib/session'

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
    if (!(await session())) return
    const me = await context.queryClient.fetchQuery(orpc.me.get.queryOptions())
    hasOrganization = me.organization !== null
  } catch (err) {
    const status = statusOf(err)
    if (status === 401) return
    console.error('[skipWhenSignedIn] the guard failed', err)
    if (cause === 'preload') return
    toast.error(tr(status === 0 || status >= 500 ? 'onboarding.unreachable' : 'onboarding.failed'))
    return
  }
  const choice = checkoutChoice(search)
  if (!hasOrganization) throw redirect({ to: '/profile', search: choice ?? {} })
  if (choice) throw redirect({ to: '/app/checkout', search: choice })
  throw redirect({ to: '/app' })
}
