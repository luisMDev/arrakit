import type { Me } from '@arrakit/contract'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { reportError } from '#/lib/api-errors'
import { orpc } from '#/lib/orpc'

export type Role = NonNullable<Me['role']>

/** The trimmed name, or the email's local part when the name is blank. */
export function displayName(person: Pick<Me, 'name' | 'email'>): string {
  const name = person.name.trim()
  return name !== '' ? name : (person.email.split('@')[0] ?? person.email)
}

/** First character of a trimmed name, uppercased ("Ana Ruiz" -> "A"). */
export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase()
}

/** Owners and admins invite, remove and pay. */
export function roleFlags(role: Role | null): { isAdmin: boolean; isOwner: boolean } {
  return { isAdmin: role === 'owner' || role === 'admin', isOwner: role === 'owner' }
}

export const meQueryKey = () => orpc.me.get.queryOptions().queryKey

export function useCurrentUser() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const options = orpc.me.get.queryOptions()
  const { data } = useQuery({ ...options, staleTime: Number.POSITIVE_INFINITY })
  const user: Me | null = data ?? null
  const role = user?.role ?? null
  return {
    user,
    name: user ? displayName(user) : '',
    role,
    ...roleFlags(role),
    planLabel: user?.plan ? t(`pricing.plan.${user.plan}`) : '',
    reload: async () => {
      try {
        await queryClient.fetchQuery({ ...options, staleTime: 0 })
      } catch (err) {
        reportError('[currentUser] reloading the signed-in person failed', err)
      }
    },
    patch: (fn: (me: Me) => Me) =>
      queryClient.setQueryData<Me>(options.queryKey, (me) => (me ? fn(me) : me)),
    signedOut: () => queryClient.removeQueries({ queryKey: options.queryKey }),
  }
}
