import { isAccountLanguage } from '@arrakit/address'
import type { Permissions } from '@arrakit/auth/permissions'
import type { Me, PaidChoice } from '@arrakit/contract'
import { isPaidPlan } from '@arrakit/plans'
import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { loadLanguage } from '#/i18n'
import { statusOf } from '#/lib/api-errors'
import { type ChoiceSearch, appLanding, checkoutChoice } from '#/lib/checkout-choice'
import { grants } from '#/lib/current-user'
import { lastWorkspace } from '#/lib/last-workspace'
import { orpc } from '#/lib/orpc'
import { searchText } from '#/lib/search-params'

interface GuardArgs<TSearch = ChoiceSearch> {
  context: { queryClient: QueryClient }
  location: { href: string }
  search: TSearch
}

/** The signed-in person or `null`; any failure but a 401 goes to Unavailable, then back to `next`. */
async function guardedMe(queryClient: QueryClient, next: string): Promise<Me | null> {
  try {
    return await queryClient.fetchQuery(orpc.me.get.queryOptions())
  } catch (err) {
    if (statusOf(err) === 401) return null
    throw redirect({ to: '/unavailable', search: { next } })
  }
}

const cachedMe = (queryClient: QueryClient) =>
  queryClient.getQueryData<Me>(orpc.me.get.queryOptions().queryKey)

/**
 * Loads the signed-in person before any /app screen renders: no session goes to /signin, no
 * organization to /profile. The account language is applied first.
 */
export async function requireUser({ context, location }: Omit<GuardArgs, 'search'>) {
  const me = await guardedMe(context.queryClient, location.href)
  if (!me) throw redirect({ to: '/signin' })
  if (!me.organization || !me.role || !me.plan) throw redirect({ to: '/profile' })
  if (isAccountLanguage(me.language)) {
    // Always queued, even when the account language looks active: an earlier switch may still be
    // loading and would win otherwise. A language file that will not load keeps the current one.
    await loadLanguage(me.language).catch((err: unknown) =>
      console.error('[requireUser] loading the account language failed', err),
    )
  }
}

/** Profile is for a signed-in person without an organization. */
export async function requireAccount({ context, location, search }: GuardArgs) {
  const me = await guardedMe(context.queryClient, location.href)
  if (!me) throw redirect({ to: '/signup' })
  if (me.organization) throw redirect(appLanding(checkoutChoice(search)))
}

/** Sign up and sign in are for visitors: a signed-in person goes on to Profile or the app. */
export async function skipWhenSignedIn({ context, location, search }: GuardArgs) {
  const me = await guardedMe(context.queryClient, location.href)
  if (!me) return
  const choice = checkoutChoice(search)
  if (!me.organization) throw redirect({ to: '/profile', search: choice ?? {} })
  throw redirect(appLanding(choice))
}

/** A screen for those whose role grants `wanted`; others go Home. `requireUser` loaded the person. */
export const requirePermission =
  (wanted: Permissions) =>
  ({ context }: Pick<GuardArgs, 'context'>) => {
    if (!grants(cachedMe(context.queryClient) ?? null, wanted)) throw redirect({ to: '/app' })
  }

/**
 * Home belongs to a workspace once the organization has one: the one last opened on this device,
 * else the first. The general Home is for an organization without workspaces, or a role that
 * reads none. `requireUser` loaded the person.
 */
export async function toWorkspaceHome({ context }: Pick<GuardArgs, 'context'>) {
  const me = cachedMe(context.queryClient) ?? null
  if (!me?.organization || !grants(me, { workspace: ['read'] })) return
  const workspaces = await context.queryClient
    .fetchQuery(orpc.workspaces.list.queryOptions())
    .catch((err: unknown) => {
      console.error('[toWorkspaceHome] listing the workspaces failed', err)
      return []
    })
  const last = lastWorkspace(me.organization.id)
  const workspace = workspaces.find(({ id }) => id === last) ?? workspaces[0]
  if (workspace) {
    throw redirect({ to: '/app/workspaces/$workspaceId', params: { workspaceId: workspace.id } })
  }
}

/** Checkout is for a paid plan and someone who manages billing; `requireUser` loaded the person. */
export function canCheckout({ context, search }: Omit<GuardArgs, 'location'>): {
  choice: PaidChoice
} {
  const choice = checkoutChoice(search)
  const me = cachedMe(context.queryClient) ?? null
  if (!choice || !grants(me, { billing: ['manage'] })) throw redirect({ to: '/app/plans' })
  return { choice }
}

export const PAID_WAIT_TRIES = 15
const PAID_WAIT_INTERVAL_MS = 1000

export const welcomeSearch = z.object({ session_id: searchText })

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Re-reads the person until the organization's plan is paid; false after every try or a failure. */
async function waitForPaidPlan(queryClient: QueryClient): Promise<boolean> {
  const options = { ...orpc.me.get.queryOptions(), staleTime: 0 }
  for (let attempt = 0; attempt < PAID_WAIT_TRIES; attempt++) {
    if (attempt > 0) await wait(PAID_WAIT_INTERVAL_MS)
    try {
      if (isPaidPlan((await queryClient.fetchQuery(options)).plan)) return true
    } catch (err) {
      console.error('[onPaidPlan] reading the plan failed', err)
      return false
    }
  }
  return false
}

/**
 * Welcome is for an organization on a paid plan. Back from Checkout (`session_id`), Stripe's
 * webhook may land after the browser, so the plan is re-read once a second for 15 tries.
 */
export async function onPaidPlan({
  context,
  search,
}: Omit<GuardArgs<z.infer<typeof welcomeSearch>>, 'location'>) {
  if (isPaidPlan(cachedMe(context.queryClient)?.plan)) return
  if (search.session_id && (await waitForPaidPlan(context.queryClient))) return
  throw redirect({ to: '/app/plans' })
}
