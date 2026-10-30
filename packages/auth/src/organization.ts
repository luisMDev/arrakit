import { APIError } from 'better-auth/api'
import { organization } from 'better-auth/plugins'

import type { AuthDeps } from './deps'
import { organizationSchema } from './organization-schema'
import { ac, roles } from './permissions'

const INVITATION_DAYS = 7

/** Sends a magic link whose callback is the join page (magicLinkSender writes the invite mail). */
export type JoinLinkSender = (email: string, joinURL: string) => Promise<void>

export function organizationPlugin(
  deps: AuthDeps,
  links: { send?: JoinLinkSender },
  unsentInvitations: Set<string>,
) {
  const { organizations, config } = deps
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
    async sendInvitationEmail({ id, email, organization }) {
      try {
        await links.send!(email, `${config.webOrigin}/join/${encodeURIComponent(id)}`)
      } catch (err) {
        organizations.log.error(
          { err, organizationId: organization.id, invitationId: id },
          'invite email not sent',
        )
        unsentInvitations.add(id)
      }
      try {
        await organizations.markInvitationEmailSent(organization.id, id, !unsentInvitations.has(id))
      } catch (err) {
        organizations.log.error(
          { err, organizationId: organization.id, invitationId: id },
          'invite email state not saved',
        )
      }
    },
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
      beforeDeleteOrganization: ({ organization }) => organizations.beforeDelete(organization.id),
      afterDeleteOrganization: ({ organization }) => organizations.afterDelete(organization.id),
      async beforeCreateInvitation({ invitation, organization }) {
        const seats = organizations.seats(organization)
        if ((await organizations.seatsTaken(organization.id, invitation.email)) >= seats.limit) {
          throw new APIError('FORBIDDEN', { message: seats.full })
        }
      },
      async beforeAcceptInvitation({ user, organization }) {
        if (await organizations.isMember(user.id, organization.id)) {
          throw new APIError('CONFLICT', { message: `You're already in ${organization.name}.` })
        }
      },
      afterRemoveMember: ({ member }) =>
        organizations.revokeGrants(member.organizationId, member.userId),
    },
  })
}
