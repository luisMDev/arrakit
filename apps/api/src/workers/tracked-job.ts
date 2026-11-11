import type { OrganizationScope, QueuePolicy, TaskRow } from '@arrakit/db'
import { z } from 'zod'

import { type JobContext, type JobDefinition, defineJob } from './job'

/** Codes every task may fail with, translated under `activity.errors.<code>`. */
export const TASK_ERRORS = {
  unexpected: 'unexpected',
  invalidInput: 'invalid_input',
  stalled: 'stalled',
} as const

/** A failure retrying cannot fix. `code` is shown, translated under `activity.errors.<code>`. */
export class TaskError extends Error {
  constructor(
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(`task failed: ${code}`, options)
  }
}

export const PROGRESS_INTERVAL_MS = 1000
/** How often a running task is marked alive, whether or not it reports progress. */
export const HEARTBEAT_INTERVAL_MS = 60_000

export interface TaskContext extends JobContext {
  task: { id: string; organizationId: string; attempt: number }
  /**
   * Records how much is done. Written at most once per PROGRESS_INTERVAL_MS, and always once all
   * the work is done; it is also the task's heartbeat.
   */
  progress(done: number, total?: number): Promise<void>
  /** Aborted when the attempt expires or the server stops. */
  signal: AbortSignal
}

/** A job whose runs people follow in Activity, as a task. */
export interface TrackedJobDefinition<Schema extends z.ZodType<object> = z.ZodType<object>> {
  /** The queue. */
  name: string
  /** Translated under `activity.kinds.<kind>`. */
  kind: string
  schema: Schema
  policy: QueuePolicy
  /** Resolves to what the task hands back, if anything. Throw TaskError to fail without retries. */
  handler(input: z.output<Schema>, context: TaskContext): Promise<Record<string, unknown> | void>
}

export const defineTrackedJob = <Schema extends z.ZodType<object>>(
  definition: TrackedJobDefinition<Schema>,
): TrackedJobDefinition<Schema> => definition

export interface TaskRequest {
  requestedBy: string | null
  workspaceId: string | null
  subject?: { type: string; id: string }
  /** User data shown with the task, such as a file name. */
  label?: string
}

/**
 * Validates `input`, then creates the task and queues its job in one transaction. The job must be
 * one of the API's TRACKED_JOBS, so that its queue exists.
 */
export function startTask<Schema extends z.ZodType<object>>(
  scope: OrganizationScope,
  job: TrackedJobDefinition<Schema>,
  request: TaskRequest,
  input: z.input<Schema>,
): Promise<TaskRow> {
  return scope.tasks.start({
    ...request,
    queue: job.name,
    kind: job.kind,
    maxAttempts: job.policy.retryLimit + 1,
    input: job.schema.parse(input),
  })
}

const taskJobSchema = z.object({ taskId: z.guid(), organizationId: z.guid(), input: z.unknown() })

function progressOf(tasks: OrganizationScope['tasks'], taskId: string, now: () => number) {
  let lastWrite = -Infinity
  let total: number | undefined
  return async (done: number, newTotal?: number) => {
    if (newTotal !== undefined) total = newTotal
    const allDone = total !== undefined && done >= total
    if (!allDone && now() - lastWrite < PROGRESS_INTERVAL_MS) return
    lastWrite = now()
    await tasks.progress(taskId, done, total)
  }
}

/**
 * The job that runs a tracked one: it starts the task's attempt, hands the handler a way to report
 * progress, and settles the task. A failure is retried (the task waits as queued) until the last
 * attempt fails it; a TaskError fails it at once; an input the schema rejects fails it and is
 * dead-lettered.
 */
export function trackedJob(
  tracked: TrackedJobDefinition,
  { now = Date.now, heartbeatMs = HEARTBEAT_INTERVAL_MS } = {},
): JobDefinition {
  return defineJob({
    name: tracked.name,
    schema: taskJobSchema,
    policy: tracked.policy,
    logFields: ({ taskId, organizationId }) => ({ taskId, organizationId }),
    async handler(job, context) {
      const { taskId, organizationId, input } = job
      const { data, log, attempt } = context
      const tasks = data.forOrganization(organizationId).tasks
      const parsed = tracked.schema.safeParse(input)
      if (!parsed.success) {
        log.error(
          { err: parsed.error, taskId, organizationId },
          'task input invalid; failed and dead-lettered without retries',
        )
        await tasks.fail(taskId, TASK_ERRORS.invalidInput)
        await data.jobs.deadLetter(tracked.name, job)
        return
      }
      const task = await tasks.begin(taskId, attempt.retryCount)
      if (!task) return

      const heartbeat = setInterval(() => {
        tasks.heartbeat(taskId).catch((err: unknown) => {
          log.error({ err, taskId, organizationId }, 'task heartbeat not written')
        })
      }, heartbeatMs)
      try {
        const result = await tracked.handler(parsed.data, {
          ...context,
          task: { id: taskId, organizationId, attempt: task.attempts },
          progress: progressOf(tasks, taskId, now),
          signal: attempt.signal,
        })
        await tasks.succeed(taskId, result ?? undefined)
      } catch (err) {
        if (err instanceof TaskError) {
          log.info({ taskId, organizationId, errorCode: err.code }, 'task failed without retries')
          await tasks.fail(taskId, err.code)
          return
        }
        const lastAttempt = attempt.retryCount >= attempt.retryLimit
        await (lastAttempt
          ? tasks.fail(taskId, TASK_ERRORS.unexpected)
          : tasks.retrying(taskId, TASK_ERRORS.unexpected))
        throw err
      } finally {
        clearInterval(heartbeat)
      }
    },
  })
}
