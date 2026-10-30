import { type SQL, and, asc, eq } from 'drizzle-orm'

import type { DataContext } from '../context'
import { isUuid } from '../organization-id'
import { members, organizations, sessions } from '../schema/index'
import type { OrganizationRow } from '../organization/index'

export interface Membership {
  organization: OrganizationRow
  /** Better Auth's role string: `owner`, `admin`, `member`, a custom role, or several joined by `,`. */
  role: string
}

export function membershipData(ctx: DataContext) {
  async function firstMembership(where: SQL | undefined): Promise<Membership | null> {
    const [row] = await ctx.db
      .select({ organization: organizations, role: members.role })
      .from(members)
      .innerJoin(organizations, eq(organizations.id, members.organizationId))
      .where(where)
      .orderBy(asc(members.createdAt), asc(members.id))
      .limit(1)
    return row ?? null
  }

  const memberOf = (userId: string) => firstMembership(eq(members.userId, userId))

  async function activeMembership(userId: string, sessionId: string): Promise<Membership | null> {
    const [row] = await ctx.db
      .select({ organization: organizations, role: members.role })
      .from(sessions)
      .innerJoin(members, eq(members.organizationId, sessions.activeOrganizationId))
      .innerJoin(organizations, eq(organizations.id, members.organizationId))
      .where(and(eq(sessions.id, sessionId), eq(members.userId, userId)))
    return row ?? (await memberOf(userId))
  }

  return {
    /** The earliest-joined membership, or null. */
    memberOf,
    /** The person's membership in `organizationId`, or null (also for an id that is no UUID). */
    membershipIn: async (userId: string, organizationId: string) =>
      isUuid(organizationId)
        ? firstMembership(
            and(
              eq(members.userId, userId),
              eq(members.organizationId, organizationId.toLowerCase()),
            ),
          )
        : null,
    /**
     * The membership in the session's active organization, read from the database (the cookie
     * cache may be stale); the earliest one when that organization is unset or no longer theirs.
     */
    activeMembership,
  }
}
