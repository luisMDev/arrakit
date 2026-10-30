import { personName } from '@arrakit/address'
import {
  type Permissions,
  allows,
  isOwnerRole,
  isStaticRole,
  rolesOf,
} from '@arrakit/auth/permissions'
import type { Me } from '@arrakit/contract'
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'

import { planLabel } from '#/components/billing/plan-copy'
import { tr } from '#/i18n'
import { statusOf } from '#/lib/api-errors'
import { orpc } from '#/lib/orpc'

/** First character of a trimmed name, uppercased ("Ana Ruiz" -> "A"). */
export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase()
}

const STATIC_ROLE_LABEL = { owner: 'roleOwner', admin: 'roleAdmin', member: 'roleMember' } as const

/** A role string as people read it: built-in roles translated, custom ones by name. */
export function roleLabel(role: string): string {
  return rolesOf(role)
    .map((name) =>
      isStaticRole(name) ? tr(`settings.membersSettings.${STATIC_ROLE_LABEL[name]}`) : name,
    )
    .join(', ')
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
    planLabel: user?.plan ? planLabel(user.plan) : '',
    patch: (fn: (me: Me) => Me) =>
      queryClient.setQueryData<Me>(queryKey, (me) => (me ? fn(me) : me)),
    refresh: () => queryClient.invalidateQueries({ queryKey }),
    signedOut: () => queryClient.removeQueries(),
  }
}

/** The current person under /app, where `requireUser` made sure they have an organization. */
export function useMember() {
  const current = useCurrentUser()
  const { user } = current
  if (!user?.organization || !user.role || !user.plan) throw new Error('No organization member')
  return { ...current, user, organization: user.organization, role: user.role, plan: user.plan }
}
