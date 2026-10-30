import type { Me } from '@arrakit/contract'
import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'

import { isLanguage, loadLanguage } from '#/i18n'
import { reportError } from '#/lib/api-errors'
import { orpc } from '#/lib/orpc'

import { guardFailure, unavailableRedirect } from './guard-failure'

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
  let me: Me
  try {
    me = await signedInPerson(context.queryClient)
  } catch (err) {
    const failure = guardFailure('[requireUser] the guard failed', err)
    if (failure === 'signed-out') throw redirect({ to: '/signin' })
    throw unavailableRedirect(failure, location.href)
  }
  if (!me.organization || !me.role || !me.plan) throw redirect({ to: '/profile' })
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
}
