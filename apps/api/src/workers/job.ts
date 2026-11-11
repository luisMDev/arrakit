import type {
  JobAttempt,
  Jobs,
  QueuePolicy,
  ScheduleOptions,
  ScopedData,
  SendOptions,
} from '@arrakit/db'
import type { z } from 'zod'

import type { AppDeps } from '../deps'
import type { Logger } from '../observability/logger'

export interface JobContext {
  data: ScopedData
  log: Logger
  attempt: JobAttempt
}

export interface JobDefinition<Schema extends z.ZodType<object> = z.ZodType<object>> {
  name: string
  schema: Schema
  policy: QueuePolicy
  handler(payload: z.output<Schema>, context: JobContext): Promise<void>
  /** Sends `data` on every cron occurrence. Without it, a previous schedule is removed. */
  schedule?: { cron: string; data: z.input<Schema> } & ScheduleOptions
  /** Fields that identify a payload in the job's log lines. */
  logFields?(payload: z.output<Schema>): Record<string, unknown>
}

export const defineJob = <Schema extends z.ZodType<object>>(
  definition: JobDefinition<Schema>,
): JobDefinition<Schema> => definition

/** Validates the payload, then queues it. Resolves to null when exclusivity refused a duplicate. */
export async function sendJob<Schema extends z.ZodType<object>>(
  jobs: Jobs,
  job: JobDefinition<Schema>,
  payload: z.input<Schema>,
  options?: SendOptions,
): Promise<string | null> {
  return jobs.send(job.name, job.schema.parse(payload), options)
}

export type WorkerDeps = Pick<AppDeps, 'data' | 'log' | 'errors'>

/**
 * Defines each job's queue and schedule and starts its worker. A payload the schema rejects is
 * dead-lettered at once (retrying cannot fix it); a failing handler is logged, reported and
 * rethrown so the queue retries it, then dead-letters it.
 */
export async function registerJobs(
  definitions: readonly JobDefinition[],
  deps: WorkerDeps,
): Promise<void> {
  await Promise.all(definitions.map((job) => registerJob(job, deps)))
}

async function registerJob(job: JobDefinition, { data, log, errors }: WorkerDeps): Promise<void> {
  const jobLog = log.child({ job: job.name })
  await data.jobs.defineQueue(job.name, job.policy)
  const worker = data.jobs.work(job.name, async (raw, attempt) => {
    const parsed = job.schema.safeParse(raw)
    if (!parsed.success) {
      jobLog.error({ err: parsed.error }, 'job payload invalid; dead-lettered without retries')
      await data.jobs.deadLetter(job.name, raw)
      return
    }
    try {
      await job.handler(parsed.data, { data, log: jobLog, attempt })
    } catch (err) {
      jobLog.error(
        { err, ...job.logFields?.(parsed.data) },
        'job failed; the queue retries it, then dead-letters it',
      )
      errors.capture(err, { job: job.name })
      throw err
    }
  })
  await Promise.all([worker, scheduleOf(job, data.jobs)])
}

async function scheduleOf(job: JobDefinition, jobs: Jobs): Promise<void> {
  if (!job.schedule) return jobs.unschedule(job.name)
  const { cron, data, ...options } = job.schedule
  await jobs.schedule(job.name, cron, job.schema.parse(data), options)
}
