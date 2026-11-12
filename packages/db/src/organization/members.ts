import { normalizeEmail } from '@arrakit/address'
import { and, asc, eq, gt, ne, sql } from 'drizzle-orm'

import type { ScopeContext } from '../context'
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

export function membersScope(ctx: ScopeContext, organizationId: OrganizationId) {
  const inOrganization = eq(members.organizationId, organizationId)

  return {
    list(): Promise<MemberView[]> {
      return ctx.scoped((tx) =>
        tx
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
          .orderBy(asc(members.createdAt), asc(members.id)),
      )
    },

    /** Members plus live invitations, not counting one to `exceptEmail` (a re-invite takes no seat). */
    seatsTaken(exceptEmail: string): Promise<number> {
      return ctx.scoped(async (tx) => {
        const [row] = await tx
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
      })
    },

    markInvitationEmailSent(invitationId: string, sent: boolean): Promise<void> {
      return ctx.scoped(async (tx) => {
        await tx
          .update(invitations)
          .set({ emailSent: sent })
          .where(
            and(eq(invitations.organizationId, organizationId), eq(invitations.id, invitationId)),
          )
      })
    },
  }
}

export type OrganizationMembers = ReturnType<typeof membersScope>
