import { and, asc, eq, sql } from 'drizzle-orm'

import type { DataContext } from '../context'
import { DomainError, isUniqueViolation } from '../errors'
import type { OrganizationId } from '../organization-id'
import { workspaces } from '../schema/index'

export type WorkspaceRow = typeof workspaces.$inferSelect

interface WorkspaceInput {
  name: string
  description: string
}

async function refusingDuplicates<T>(name: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    throw new DomainError('CONFLICT', `A workspace named ${name} already exists.`)
  }
}

export function workspacesScope(ctx: DataContext, organizationId: OrganizationId) {
  const { db } = ctx
  const inOrganization = eq(workspaces.organizationId, organizationId)
  const byId = (id: string) => and(inOrganization, eq(workspaces.id, id))

  return {
    list: (): Promise<WorkspaceRow[]> =>
      db
        .select()
        .from(workspaces)
        .where(inOrganization)
        .orderBy(asc(sql`lower(${workspaces.name})`), asc(workspaces.id)),

    /** Refuses a name another workspace of the organization has, ignoring case (CONFLICT). */
    create(input: WorkspaceInput & { createdBy: string }): Promise<WorkspaceRow> {
      return refusingDuplicates(input.name, async () => {
        const [row] = await db
          .insert(workspaces)
          .values({ ...input, organizationId })
          .returning()
        return row!
      })
    },

    /** Undefined when the organization has no such workspace; CONFLICT on a taken name. */
    update(id: string, input: WorkspaceInput): Promise<WorkspaceRow | undefined> {
      return refusingDuplicates(input.name, async () => {
        const [row] = await db.update(workspaces).set(input).where(byId(id)).returning()
        return row
      })
    },

    /** False when the organization has no such workspace. */
    async remove(id: string): Promise<boolean> {
      const deleted = await db.delete(workspaces).where(byId(id)).returning({ id: workspaces.id })
      return deleted.length > 0
    },
  }
}
