import type { Permissions } from '@arrakit/auth/permissions'
import { type QueryClient, queryOptions } from '@tanstack/react-query'

import { authCall } from '#/lib/auth-call'
import { authClient } from '#/lib/auth-client'
import { orpc } from '#/lib/orpc'

const org = authClient.organization

export interface OrganizationMember {
  id: string
  userId: string
  role: string
  user: { id: string; name: string; email: string; image?: string | null }
}

export interface PendingInvitation {
  id: string
  email: string
  role: string
  createdAt: Date
  expiresAt: Date
  emailSent: boolean
}

export interface CustomRole {
  id: string
  role: string
  permission: Permissions
}

export interface Team {
  id: string
  name: string
}

const isPending = (invitation: { status: string; expiresAt: Date | string }) =>
  invitation.status === 'pending' && new Date(invitation.expiresAt).getTime() > Date.now()

export const organizationQueries = {
  list: () =>
    queryOptions({
      queryKey: ['org', 'list'],
      queryFn: () => authCall(org.list()),
    }),
  members: (organizationId: string) =>
    queryOptions({
      queryKey: ['org', organizationId, 'members'],
      queryFn: async (): Promise<OrganizationMember[]> =>
        (await authCall(org.listMembers({ query: { organizationId } }))).members,
    }),
  invitations: (organizationId: string) =>
    queryOptions({
      queryKey: ['org', organizationId, 'invitations'],
      queryFn: async (): Promise<PendingInvitation[]> =>
        (await authCall(org.listInvitations({ query: { organizationId } })))
          .filter(isPending)
          .map((invitation) => ({
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            createdAt: new Date(invitation.createdAt),
            expiresAt: new Date(invitation.expiresAt),
            emailSent: invitation.emailSent === true,
          })),
    }),
  roles: (organizationId: string) =>
    queryOptions({
      queryKey: ['org', organizationId, 'roles'],
      queryFn: async () =>
        (await authCall(org.listRoles({ query: { organizationId } }))) as CustomRole[],
    }),
  teams: (organizationId: string) =>
    queryOptions({
      queryKey: ['org', organizationId, 'teams'],
      queryFn: (): Promise<Team[]> => authCall(org.listTeams({ query: { organizationId } })),
    }),
  teamMembers: (teamId: string) => orpc.teams.members.queryOptions({ input: { teamId } }),
}

/** Makes `organizationId` the session's organization (none for `null`) and reloads every screen. */
export async function switchOrganization(
  queryClient: QueryClient,
  organizationId: string | null,
): Promise<void> {
  await authCall(org.setActive({ organizationId }))
  await queryClient.resetQueries()
}
