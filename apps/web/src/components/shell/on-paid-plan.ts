import type { Me } from '@arrakit/contract'
import { isPaidPlan } from '@arrakit/plans'
import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'

import { reportError } from '#/lib/api-errors'
import { orpc } from '#/lib/orpc'

export const PAID_WAIT_TRIES = 15
const PAID_WAIT_INTERVAL_MS = 1000

const isPaid = (me: Me | undefined) => isPaidPlan(me?.plan)

export const welcomeSearch = (search: Record<string, unknown>): { session_id?: string } =>
  typeof search.session_id === 'string' ? { session_id: search.session_id } : {}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Re-reads the person until the organization's plan is paid; false after every try or a failure. */
async function waitForPaidPlan(queryClient: QueryClient): Promise<boolean> {
  const options = { ...orpc.me.get.queryOptions(), staleTime: 0 }
  for (let attempt = 0; attempt < PAID_WAIT_TRIES; attempt++) {
    if (attempt > 0) await wait(PAID_WAIT_INTERVAL_MS)
    try {
      if (isPaid(await queryClient.fetchQuery(options))) return true
    } catch (err) {
      reportError('[onPaidPlan] reading the plan failed', err)
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
}: {
  context: { queryClient: QueryClient }
  search: { session_id?: string }
}) {
  const me = context.queryClient.getQueryData<Me>(orpc.me.get.queryOptions().queryKey)
  if (isPaid(me)) return
  if (search.session_id && (await waitForPaidPlan(context.queryClient))) return
  throw redirect({ to: '/app/plans' })
}
