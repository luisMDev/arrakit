import { eq } from 'drizzle-orm'

import type { DataContext } from '../context'
import { OrganizationNameUnusableError } from '../errors'
import type { OrganizationId } from '../organization-id'
import { organizations } from '../schema/index'

export type OrganizationRow = typeof organizations.$inferSelect

export function organizationScope(ctx: DataContext, organizationId: OrganizationId) {
  return {
    /** The organization's own row, or undefined when it is gone. */
    async organization(): Promise<OrganizationRow | undefined> {
      const [row] = await ctx.db
        .select()
        .from(organizations)
        .where(eq(organizations.id, organizationId))
      return row
    },
    /** Renames (trimmed); slug unchanged. Undefined when the organization is gone. */
    async rename(rawName: string): Promise<OrganizationRow | undefined> {
      const name = rawName.trim()
      if (name === '') throw new OrganizationNameUnusableError()
      const [row] = await ctx.db
        .update(organizations)
        .set({ name })
        .where(eq(organizations.id, organizationId))
        .returning()
      return row
    },
  }
}
