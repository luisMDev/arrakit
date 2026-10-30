import { type OrganizationRole, toOrganizationRole } from '@arrakit/address'
import { asc, eq } from 'drizzle-orm'

import type { DataContext } from '../context'
import { members, organizations } from '../schema/index'
import type { OrganizationRow } from '../organization/organization'

export interface Membership {
  organization: OrganizationRow
  role: OrganizationRole
}

export function membershipData(ctx: DataContext) {
  async function memberOf(userId: string): Promise<Membership | null> {
    const [row] = await ctx.db
      .select({ organization: organizations, role: members.role })
      .from(members)
      .innerJoin(organizations, eq(organizations.id, members.organizationId))
      .where(eq(members.userId, userId))
      .orderBy(asc(members.createdAt), asc(members.id))
      .limit(1)
    return row ? { organization: row.organization, role: toOrganizationRole(row.role) } : null
  }

  return {
    /** The earliest-joined membership, or null. */
    memberOf,
    async organizationOf(userId: string): Promise<OrganizationRow | null> {
      return (await memberOf(userId))?.organization ?? null
    },
  }
}
