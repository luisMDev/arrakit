import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'

import { isLanguage, loadLanguage } from '#/i18n'
import { reportError } from '#/lib/api-errors'

import { guardedMe } from './guarded-me'

/**
 * Loads the signed-in person before any /app screen renders: no session goes to /signin, no
 * organization to /profile. The account language is applied first.
 */
export async function requireUser({
  context,
  location,
}: {
  context: { queryClient: QueryClient }
  location: { href: string }
}) {
  const me = await guardedMe(context.queryClient, location.href)
  if (!me) throw redirect({ to: '/signin' })
  if (!me.organization || !me.role || !me.plan) throw redirect({ to: '/profile' })
  if (isLanguage(me.language)) {
    // Always queued, even when the account language looks active: an earlier switch may still be
    // loading and would win otherwise. A language file that will not load keeps the current one.
    await loadLanguage(me.language).catch((err: unknown) =>
      reportError('[requireUser] loading the account language failed', err),
    )
  }
}
