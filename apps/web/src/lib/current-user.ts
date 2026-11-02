import { personName } from '@arrakit/address'
import {
  type Permissions,
  allows,
  isOwnerRole,
  isStaticRole,
  rolesOf,
} from '@arrakit/auth/permissions'
import type { Me } from '@arrakit/contract'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { i18n } from '#/i18n'
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
      isStaticRole(name) ? i18n.t(`settings.membersSettings.${STATIC_ROLE_LABEL[name]}`) : name,
    )
    .join(', ')
}

/** True when the person's role in their organization grants every action `wanted` names. */
export const grants = (me: Pick<Me, 'permissions'> | null, wanted: Permissions): boolean =>
  me !== null && allows(me.permissions as Permissions, wanted)

/** What the person may do in their organization, by area of the app. */
function accessOf(me: Me | null) {
  const can = (wanted: Permissions) => grants(me, wanted)
  return {
    can,
    isOwner: isOwnerRole(me?.role ?? ''),
    managesMembers: can({ member: ['update'] }) || can({ invitation: ['create'] }),
    managesBilling: can({ billing: ['manage'] }),
  }
}

export function useCurrentUser() {
  const queryClient = useQueryClient()
  const { queryKey } = orpc.me.get.queryOptions()
  const { data } = useQuery(orpc.me.get.queryOptions())
  const user: Me | null = data ?? null
  return {
    user,
    name: user ? personName(user.name, user.email) : '',
    ...accessOf(user),
    patch: (fn: (me: Me) => Me) =>
      queryClient.setQueryData<Me>(queryKey, (me) => (me ? fn(me) : me)),
    signedOut: () => queryClient.removeQueries(),
  }
}

type Member = Me & {
  organization: NonNullable<Me['organization']>
  role: NonNullable<Me['role']>
  plan: NonNullable<Me['plan']>
}

const isMember = (user: Me | null): user is Member =>
  Boolean(user?.organization && user.role && user.plan)

/** The current person under /app, where `requireUser` made sure they have an organization. */
export function useMember() {
  const current = useCurrentUser()
  const { user } = current
  if (!isMember(user)) throw new Error('No organization member')
  return { ...current, user }
}
