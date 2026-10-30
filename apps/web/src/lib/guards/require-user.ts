import type { Me } from '@arrakit/contract'
import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'

import { isLanguage, loadLanguage } from '#/i18n'
import { reportError, statusOf } from '#/lib/api-errors'
import { orpc } from '#/lib/orpc'

async function signedInPerson(queryClient: QueryClient): Promise<Me> {
  const options = orpc.me.get.queryOptions()
  const cached = queryClient.getQueryData<Me>(options.queryKey)
  if (cached?.organization) return cached
  return queryClient.fetchQuery({ ...options, staleTime: 0 })
}

/**
 * Loads the signed-in person once before any /app screen renders. No organization goes to
 * /profile, no session to /signin, a 403 to the forbidden screen and any other failure to
 * /unavailable with `next` = the requested URL. The account language is applied first.
 */
export async function requireUser({
  context,
  location,
}: {
  context: { queryClient: QueryClient }
  location: { href: string }
}) {
  let outcome: 'ok' | 'profile' | 'signin' | 'forbidden' | 'unavailable'
  try {
    const me = await signedInPerson(context.queryClient)
    if (!me.organization || !me.role || !me.plan) outcome = 'profile'
    else {
      if (isLanguage(me.language)) {
        // Always queued, even when the account language looks active: an earlier switch (this
        // browser's remembered or own language) may still be loading and would win otherwise.
        // The switch is serialized behind it and does nothing when the language is already on.
        // A language file that will not load (a stale chunk, offline) keeps the current
        // language rather than hiding the app behind the Unavailable screen.
        await loadLanguage(me.language).catch((err: unknown) =>
          reportError('[requireUser] loading the account language failed', err),
        )
      }
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
