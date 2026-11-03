import { and, eq, lt } from 'drizzle-orm'

import type { DataContext } from '../context'
import { files } from '../schema/index'

export function filesData(ctx: DataContext) {
  return {
    /** Organizations holding a pending file created before `before`. */
    async organizationsWithPendingFiles(before: Date): Promise<string[]> {
      const rows = await ctx.db
        .selectDistinct({ organizationId: files.organizationId })
        .from(files)
        .where(and(eq(files.status, 'pending'), lt(files.createdAt, before)))
      return rows.map((row) => row.organizationId)
    },
  }
}
