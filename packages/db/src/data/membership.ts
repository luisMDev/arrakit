import { asc, eq } from 'drizzle-orm'

import type { DataContext } from '../context'
import { members, organizations } from '../schema/index'
import type { OrganizationRole } from '../organization/members'
import type { OrganizationRow } from '../organization/organization'

export interface Membership {
  organization: OrganizationRow
  role: OrganizationRole
}

const ROLES: readonly string[] = ['owner', 'admin', 'member']
/** Any stored role that is not exactly one of the three reads as 'member' (least privilege). */
const toRole = (role: string): OrganizationRole =>
  ROLES.includes(role) ? (role as OrganizationRole) : 'member'

export function membershipData(ctx: DataContext) {
  async function memberOf(userId: string): Promise<Membership | null> {
    const [row] = await ctx.db
      .select({ organization: organizations, role: members.role })
      .from(members)
      .innerJoin(organizations, eq(organizations.id, members.organizationId))
      .where(eq(members.userId, userId))
      .orderBy(asc(members.createdAt), asc(members.id))
      .limit(1)
    return row ? { organization: row.organization, role: toRole(row.role) } : null
  }

  return {
    /** The earliest-joined membership, or null. */
    memberOf,
    async organizationOf(userId: string): Promise<OrganizationRow | null> {
      return (await memberOf(userId))?.organization ?? null
    },
  }
}
