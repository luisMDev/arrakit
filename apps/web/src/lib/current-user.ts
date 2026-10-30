import { personName } from '@arrakit/address'
import { type Permissions, allows, isOwnerRole } from '@arrakit/auth/permissions'
import type { Me } from '@arrakit/contract'
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { statusOf } from '#/lib/api-errors'
import { orpc } from '#/lib/orpc'

/** First character of a trimmed name, uppercased ("Ana Ruiz" -> "A"). */
export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase()
}

/** True when the person's role in their organization grants every action `wanted` names. */
export const grants = (me: Pick<Me, 'permissions'> | null, wanted: Permissions): boolean =>
  me !== null && allows(me.permissions as Permissions, wanted)

/** What the person may do in their organization, by area of the app. */
export function accessOf(me: Me | null) {
  const can = (wanted: Permissions) => grants(me, wanted)
  return {
    can,
    isOwner: isOwnerRole(me?.role ?? ''),
    managesMembers: can({ member: ['update'] }) || can({ invitation: ['create'] }),
    managesBilling: can({ billing: ['manage'] }),
  }
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
    ...accessOf(user),
    planLabel: user?.plan ? t(`pricing.plan.${user.plan}`) : '',
    patch: (fn: (me: Me) => Me) =>
      queryClient.setQueryData<Me>(queryKey, (me) => (me ? fn(me) : me)),
    refresh: () => queryClient.invalidateQueries({ queryKey }),
    signedOut: () => queryClient.removeQueries(),
  }
}
