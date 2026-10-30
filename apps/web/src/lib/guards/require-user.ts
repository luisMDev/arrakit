import type { QueryClient } from '@tanstack/react-query'
import { type ParsedLocation, redirect } from '@tanstack/react-router'

import { i18n, isLanguage, loadLanguage } from '#/i18n'
import { reportError, statusOf } from '#/lib/api-errors'
import { orpc } from '#/lib/orpc'

export async function requireUser({
  context,
  location,
}: {
  context: { queryClient: QueryClient }
  location: ParsedLocation
}) {
  let outcome: 'ok' | 'profile' | 'signin' | 'forbidden' | 'unavailable'
  try {
    const me = await context.queryClient.ensureQueryData(orpc.me.get.queryOptions())
    if (!me.organization) outcome = 'profile'
    else {
      if (isLanguage(me.language) && me.language !== i18n.language) await loadLanguage(me.language)
      outcome = 'ok'
    }
  } catch (err) {
    const status = statusOf(err)
    if (status === 401) outcome = 'signin'
    else {
      reportError('[requireUser] the guard failed', err)
      outcome = status === 403 ? 'forbidden' : 'unavailable'
    }
  }
  if (outcome === 'profile') throw redirect({ to: '/profile' })
  if (outcome === 'signin') throw redirect({ to: '/signin' })
  if (outcome === 'forbidden')
    throw redirect({ to: '/unavailable', search: { reason: 'forbidden' } })
  if (outcome === 'unavailable')
    throw redirect({ to: '/unavailable', search: { next: location.href } })
}
