import { eq } from 'drizzle-orm'

import type { Database } from '../connection'
import type { DataContext } from '../context'
import { OrganizationNameUnusableError } from '../errors'
import type { OrganizationId } from '../organization-id'
import { organizations } from '../schema/index'

export type OrganizationRow = typeof organizations.$inferSelect

/** With `lock`, the row is held (for no key update) until the transaction ends. */
export async function organizationRow(
  db: Database,
  id: string,
  { lock = false } = {},
): Promise<OrganizationRow | undefined> {
  const query = db.select().from(organizations).where(eq(organizations.id, id))
  const [row] = await (lock ? query.for('no key update') : query)
  return row
}

export function organizationScope(ctx: DataContext, organizationId: OrganizationId) {
  return {
    /** The organization's own row, or undefined when it is gone. */
    organization: () => organizationRow(ctx.db, organizationId),
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
