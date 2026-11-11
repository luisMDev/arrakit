import { eventIterator } from '@orpc/contract'
import { z } from 'zod'

import { base } from './common'

export const TASK_PAGE_MAX = 100

export const taskStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed'])
export type TaskStatus = z.infer<typeof taskStatusSchema>

export const taskSchema = z.object({
  id: z.uuid(),
  /** Translated under `activity.kinds.<kind>`. */
  kind: z.string(),
  /** User data shown with the task, such as a file name. */
  label: z.string().nullable(),
  workspaceId: z.uuid().nullable(),
  subject: z.object({ type: z.string(), id: z.string() }).nullable(),
  status: taskStatusSchema,
  /** Attempts started so far; a queued task with attempts is waiting to retry. */
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  /** `total` null: how much work there is is not known. */
  progress: z.object({ done: z.number().int(), total: z.number().int().nullable() }),
  /** Translated under `activity.errors.<code>`. */
  errorCode: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  requestedById: z.string().nullable(),
  requesterName: z.string().nullable(),
  requestedByYou: z.boolean(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
})
export type TaskView = z.infer<typeof taskSchema>

/** Without `workspaceId`, every task the caller may see. */
export const taskScopeSchema = z.object({ workspaceId: z.uuid().optional() })

export const taskListInputSchema = taskScopeSchema.extend({
  status: z.enum(['active', 'finished']),
  /** The `next` of the previous page. */
  after: z.string().optional(),
  limit: z.number().int().min(1).max(TASK_PAGE_MAX).default(50),
})

export const taskPageSchema = z.object({ tasks: z.array(taskSchema), next: z.string().nullable() })
export type TaskPage = z.infer<typeof taskPageSchema>

/**
 * `task`: a task as it is now, sent whenever it changes. `resync`: changes may have been missed,
 * so read the lists again.
 */
export const taskChangeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('task'), task: taskSchema }),
  z.object({ type: z.literal('resync') }),
])
export type TaskChange = z.infer<typeof taskChangeSchema>

/**
 * Background work of the organization. Everyone sees the tasks they started; `task:read` sees
 * them all; tasks of a workspace also need `workspace:read`. A task the caller may not see
 * answers 404.
 */
export const tasksContract = {
  list: base.input(taskListInputSchema).output(taskPageSchema),
  get: base.input(z.object({ id: z.uuid() })).output(taskSchema),
  /**
   * Streams changes to the tasks `list` answers, until the client leaves or the server ends it.
   * It starts with a resync once listening: read the lists then, so no change falls in between.
   */
  watch: base.input(taskScopeSchema).output(eventIterator(taskChangeSchema)),
}
