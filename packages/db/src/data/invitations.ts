import { normalizeEmail } from '@arrakit/address'
import { and, eq } from 'drizzle-orm'

import type { DataContext } from '../context'
import { liveInvitation } from '../organization/members'
import type { OrganizationRow } from '../organization/index'
import { invitations, organizations, users } from '../schema/index'

export interface InvitationForPerson {
  id: string
  email: string
  role: string
  expiresAt: Date
  organization: OrganizationRow
  inviter: { name: string; email: string }
}

const usableId = (id: unknown): id is string => typeof id === 'string' && id !== ''

export function invitationsData(ctx: DataContext) {
  return {
    /** The live invitation `invitationId` addressed exactly to `email`, or null. */
    async invitationFor(invitationId: string, email: string): Promise<InvitationForPerson | null> {
      if (!usableId(invitationId)) return null
      const [row] = await ctx.db
        .select({
          invitation: invitations,
          organization: organizations,
          inviterName: users.name,
          inviterEmail: users.email,
        })
        .from(invitations)
        .innerJoin(organizations, eq(invitations.organizationId, organizations.id))
        .innerJoin(users, eq(invitations.inviterId, users.id))
        .where(and(eq(invitations.id, invitationId), liveInvitation()))
      if (!row || row.invitation.email !== normalizeEmail(email)) return null
      return {
        id: row.invitation.id,
        email: row.invitation.email,
        role: row.invitation.role ?? 'member',
        expiresAt: row.invitation.expiresAt,
        organization: row.organization,
        inviter: { name: row.inviterName, email: row.inviterEmail },
      }
    },
  }
}
