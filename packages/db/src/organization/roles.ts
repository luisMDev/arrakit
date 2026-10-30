import { asc, eq } from 'drizzle-orm'

import type { DataContext } from '../context'
import type { OrganizationId } from '../organization-id'
import { organizationRoles } from '../schema/index'

export interface CustomRole {
  role: string
  /** The role's statements as Better Auth stores them (JSON). */
  permission: string
}

export function rolesScope(ctx: DataContext, organizationId: OrganizationId) {
  return {
    /** The organization's custom roles (Better Auth dynamic access control). */
    customRoles: (): Promise<CustomRole[]> =>
      ctx.db
        .select({ role: organizationRoles.role, permission: organizationRoles.permission })
        .from(organizationRoles)
        .where(eq(organizationRoles.organizationId, organizationId))
        .orderBy(asc(organizationRoles.role)),
  }
}
