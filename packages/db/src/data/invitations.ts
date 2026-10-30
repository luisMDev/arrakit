import { normalizeEmail } from '@arrakit/address'
import { PLAN_OFFERS } from '@arrakit/plans'
import { and, eq } from 'drizzle-orm'

import type { Database } from '../connection'
import type { DataContext } from '../context'
import { InvitationNotFoundError, PersonHasOrganizationError } from '../errors'
import {
  type AssignableRole,
  liveInvitation,
  lockedPlan,
  memberCount,
  seatLimitError,
  toAssignableRole,
} from '../organization/members'
import type { OrganizationRow } from '../organization/organization'
import { invitations, members, organizations, users } from '../schema/index'
import type { Membership } from './membership'

export interface InvitationForPerson {
  id: string
  email: string
  role: AssignableRole
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
        role: toAssignableRole(row.invitation.role),
        expiresAt: row.invitation.expiresAt,
        organization: row.organization,
        inviter: { name: row.inviterName, email: row.inviterEmail },
      }
    },

    /**
     * Adds the person to the inviting organization and marks the invitation accepted. Only members
     * count against seats here, so invitations sent before a downgrade get in while a seat is left.
     */
    async acceptInvitation(input: {
      invitationId: string
      userId: string
      email: string
    }): Promise<Membership> {
      const { invitationId, userId, email } = input
      if (!usableId(invitationId)) throw new InvitationNotFoundError()
      return ctx.db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as Database
        const [person] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .for('update')
        if (!person) throw new InvitationNotFoundError()
        const [row] = await tx
          .select({ invitation: invitations, organization: organizations })
          .from(invitations)
          .innerJoin(organizations, eq(invitations.organizationId, organizations.id))
          .where(and(eq(invitations.id, invitationId), liveInvitation()))
          .for('update', { of: invitations })
        if (!row || row.invitation.email !== normalizeEmail(email)) {
          throw new InvitationNotFoundError()
        }
        const [membership] = await tx
          .select({ id: members.id })
          .from(members)
          .where(eq(members.userId, userId))
          .limit(1)
        if (membership) throw new PersonHasOrganizationError()
        const plan = await lockedPlan(tx, row.organization.id)
        if (plan && (await memberCount(tx, row.organization.id)) >= PLAN_OFFERS[plan].seats) {
          throw seatLimitError(plan)
        }
        const role = toAssignableRole(row.invitation.role)
        await tx.insert(members).values({ organizationId: row.organization.id, userId, role })
        await tx
          .update(invitations)
          .set({ status: 'accepted' })
          .where(eq(invitations.id, invitationId))
        return { organization: row.organization, role }
      })
    },
  }
}
