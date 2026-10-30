import { normalizeEmail } from '@arrakit/address'
import { and, asc, eq, gt, ne, sql } from 'drizzle-orm'

import type { DataContext } from '../context'
import type { OrganizationId } from '../organization-id'
import { invitations, members, users } from '../schema/index'

export interface MemberView {
  userId: string
  name: string
  email: string
  image: string | null
  role: string
  joinedAt: Date
}

export const liveInvitation = () =>
  and(eq(invitations.status, 'pending'), gt(invitations.expiresAt, sql`now()`))

export function membersScope(ctx: DataContext, organizationId: OrganizationId) {
  const { db } = ctx
  const inOrganization = eq(members.organizationId, organizationId)

  return {
    async list(): Promise<MemberView[]> {
      return db
        .select({
          userId: members.userId,
          name: users.name,
          email: users.email,
          image: users.image,
          role: members.role,
          joinedAt: members.createdAt,
        })
        .from(members)
        .innerJoin(users, eq(members.userId, users.id))
        .where(inOrganization)
        .orderBy(asc(members.createdAt), asc(members.id))
    },

    /** Members plus live invitations, not counting one to `exceptEmail` (a re-invite takes no seat). */
    async seatsTaken(exceptEmail: string): Promise<number> {
      const [row] = await db
        .select({
          n: sql<number>`(select count(*)::int from ${members} where ${inOrganization}) + count(*)::int`,
        })
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, organizationId),
            liveInvitation(),
            ne(invitations.email, normalizeEmail(exceptEmail)),
          ),
        )
      return row?.n ?? 0
    },

    async markInvitationEmailSent(invitationId: string, sent: boolean): Promise<void> {
      await db
        .update(invitations)
        .set({ emailSent: sent })
        .where(
          and(eq(invitations.organizationId, organizationId), eq(invitations.id, invitationId)),
        )
    },

    /** Records that `userId` accepted the Terms and the Privacy Policy now. */
    async acceptTerms(userId: string): Promise<void> {
      await db
        .update(members)
        .set({ termsAcceptedAt: sql`now()` })
        .where(and(inOrganization, eq(members.userId, userId)))
    },
  }
}

export type OrganizationMembers = ReturnType<typeof membersScope>
