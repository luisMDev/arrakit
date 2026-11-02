import { defineRequestState, tryGetCurrentAuthEndpointContext } from '@better-auth/core/context'
import { APIError } from 'better-auth/api'
import { organization } from 'better-auth/plugins'

import type { AuthDeps } from './auth'
import {
  ac,
  customRoleMap,
  memberChangeRefusal,
  organizationSchema,
  permissionsOf,
  roles,
} from './permissions'

const INVITATION_DAYS = 7
const ACTOR_UNKNOWN = "You can't change this organization's members."

/** Set by the before hook of `/organization/create` when the creator sent `termsAccepted: true`. */
export const termsAccepted = defineRequestState(() => false)

type Change = { targetRole?: string; newRole?: string; self: boolean }

export function organizationPlugin(deps: AuthDeps) {
  const { organizations, data } = deps

  const refuse = (message: string): never => {
    throw new APIError('FORBIDDEN', { message })
  }

  /** Refuses the member changes Better Auth would allow but the organization's rules do not. */
  async function checkMemberChange(organizationId: string, actorId: string, change: Change) {
    const actor = await data.membershipIn(actorId, organizationId)
    if (!actor) return refuse(ACTOR_UNKNOWN)
    const custom = customRoleMap(await data.forOrganization(organizationId).customRoles())
    const refusal = memberChangeRefusal({
      actorRole: actor.role,
      actorPermissions: permissionsOf(actor.role, custom),
      custom,
      ...change,
    })
    if (refusal) refuse(refusal)
  }

  /** The signed-in person making the request; the member hooks receive no request context. */
  function actorId(): string {
    const session = tryGetCurrentAuthEndpointContext()?.context.session
    return session?.user.id ?? refuse(ACTOR_UNKNOWN)
  }

  return organization({
    ac,
    roles,
    creatorRole: 'owner',
    membershipLimit: (_user, organization) => organizations.seats(organization).limit,
    invitationExpiresIn: INVITATION_DAYS * 24 * 60 * 60,
    cancelPendingInvitationsOnReInvite: true,
    requireEmailVerificationOnInvitation: true,
    teams: { enabled: true, defaultTeam: { enabled: false }, allowRemovingAllTeams: true },
    dynamicAccessControl: { enabled: true, maximumRolesPerOrganization: 20 },
    schema: organizationSchema,
    organizationHooks: {
      async beforeUpdateOrganization({ organization }) {
        const { name, ...rest } = organization
        if (Object.values(rest).some((value) => value !== undefined)) {
          throw new APIError('BAD_REQUEST', { message: 'Only the name changes.' })
        }
        const trimmed = typeof name === 'string' ? name.trim() : ''
        if (trimmed === '') {
          throw new APIError('BAD_REQUEST', { message: 'Give the organization a name.' })
        }
        return { data: { name: trimmed } }
      },
      async beforeDeleteOrganization({ organization }, ctx) {
        try {
          await organizations.beforeDelete(organization.id)
        } catch (err) {
          // The plugin clears the active organization before this hook; a kept one stays active.
          const session = ctx?.context.session?.session
          if (session?.activeOrganizationId === organization.id) {
            await ctx!.context.internalAdapter.updateSession(session.token, {
              activeOrganizationId: organization.id,
            })
          }
          throw err
        }
      },
      afterDeleteOrganization: ({ organization }) => organizations.afterDelete(organization.id),
      async beforeAddMember() {
        if (tryGetCurrentAuthEndpointContext()?.path !== '/organization/create') return
        if (!(await termsAccepted.get())) return
        return { data: { termsAcceptedAt: new Date() } }
      },
      async beforeRemoveMember({ member, organization }) {
        const actor = actorId()
        await checkMemberChange(organization.id, actor, {
          targetRole: member.role,
          self: member.userId === actor,
        })
      },
      async beforeUpdateMemberRole({ member, newRole, organization }) {
        const actor = actorId()
        await checkMemberChange(organization.id, actor, {
          targetRole: member.role,
          newRole,
          self: member.userId === actor,
        })
      },
      async beforeCreateInvitation({ invitation, inviter, organization }) {
        await checkMemberChange(organization.id, inviter.id, {
          newRole: invitation.role,
          self: false,
        })
        const seats = organizations.seats(organization)
        if (
          (await data.forOrganization(organization.id).members.seatsTaken(invitation.email)) >=
          seats.limit
        ) {
          throw new APIError('FORBIDDEN', { message: seats.full })
        }
      },
      async beforeAcceptInvitation({ user, organization }) {
        if (await data.membershipIn(user.id, organization.id)) {
          throw new APIError('CONFLICT', { message: `You're already in ${organization.name}.` })
        }
      },
      afterRemoveMember: ({ member }) => data.revokeGrants(member.organizationId, member.userId),
    },
  })
}
