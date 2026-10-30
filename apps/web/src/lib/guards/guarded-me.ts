import type { Me } from '@arrakit/contract'
import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'

import { loadMe } from '#/lib/current-user'

/** The signed-in person or `null`; any failure but a 401 goes to Unavailable, then back to `next`. */
export async function guardedMe(queryClient: QueryClient, next: string): Promise<Me | null> {
  try {
    return await loadMe(queryClient)
  } catch {
    throw redirect({ to: '/unavailable', search: { next } })
  }
}
