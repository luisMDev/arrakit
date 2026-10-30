import { isAdminRole, personName } from '@arrakit/address'
import type { Me } from '@arrakit/contract'
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { statusOf } from '#/lib/api-errors'
import { orpc } from '#/lib/orpc'

export type Role = NonNullable<Me['role']>

/** First character of a trimmed name, uppercased ("Ana Ruiz" -> "A"). */
export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase()
}

/** Owners and admins invite, remove and pay. */
export function roleFlags(role: Role | null): { isAdmin: boolean; isOwner: boolean } {
  return { isAdmin: isAdminRole(role), isOwner: role === 'owner' }
}

/** The signed-in person, or `null` when signed out (a 401); any other failure throws. */
export async function loadMe(queryClient: QueryClient): Promise<Me | null> {
  try {
    return await queryClient.fetchQuery(orpc.me.get.queryOptions())
  } catch (err) {
    if (statusOf(err) === 401) return null
    throw err
  }
}

export function useCurrentUser() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { queryKey } = orpc.me.get.queryOptions()
  const { data } = useQuery(orpc.me.get.queryOptions())
  const user: Me | null = data ?? null
  const role = user?.role ?? null
  return {
    user,
    name: user ? personName(user.name, user.email) : '',
    role,
    ...roleFlags(role),
    planLabel: user?.plan ? t(`pricing.plan.${user.plan}`) : '',
    patch: (fn: (me: Me) => Me) =>
      queryClient.setQueryData<Me>(queryKey, (me) => (me ? fn(me) : me)),
    refresh: () => queryClient.invalidateQueries({ queryKey }),
    signedOut: () => queryClient.removeQueries({ queryKey }),
  }
}
