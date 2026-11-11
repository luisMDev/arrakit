import { and, eq, inArray, lt, or } from 'drizzle-orm'

import type { DataContext } from '../context'
import { FINISHED_TASK_STATUSES, tasks } from '../schema/index'

export interface StalledTask {
  organizationId: string
  id: string
}

export function tasksData(ctx: DataContext) {
  return {
    /**
     * Tasks no worker is moving: running with no heartbeat since `runningBefore`, or queued and
     * untouched since `queuedBefore`. Fail them through their organization's scope.
     */
    async stalledTasks(cutoffs: {
      runningBefore: Date
      queuedBefore: Date
    }): Promise<StalledTask[]> {
      return ctx.db
        .select({ organizationId: tasks.organizationId, id: tasks.id })
        .from(tasks)
        .where(
          or(
            and(eq(tasks.status, 'running'), lt(tasks.updatedAt, cutoffs.runningBefore)),
            and(eq(tasks.status, 'queued'), lt(tasks.updatedAt, cutoffs.queuedBefore)),
          ),
        )
    },

    /** Deletes tasks that finished before `before`; resolves to how many went. */
    async removeFinishedTasks(before: Date): Promise<number> {
      const removed = await ctx.db
        .delete(tasks)
        .where(
          and(inArray(tasks.status, [...FINISHED_TASK_STATUSES]), lt(tasks.finishedAt, before)),
        )
        .returning({ id: tasks.id })
      return removed.length
    },
  }
}
