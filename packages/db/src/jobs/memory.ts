import { randomUUID } from 'node:crypto'

import {
  DEFAULT_EXPIRE_IN_SECONDS,
  deadLetterOf,
  type JobAttempt,
  type JobsRuntime,
  type PublishOptions,
  type QueuePolicy,
  type ScheduleOptions,
  type SendOptions,
} from './types'

export interface SentJob {
  id: string
  name: string
  data: object
  options: SendOptions
}

export interface PublishedEvent {
  event: string
  data: object
  options: PublishOptions
}

export interface ScheduledJob {
  cron: string
  data: object
  options: ScheduleOptions
}

export interface MemoryJobs extends JobsRuntime {
  queues: Map<string, Required<QueuePolicy>>
  /** Without `attempt`, a first attempt on the queue's retry limit. */
  workers: Map<string, (data: object, attempt?: JobAttempt) => Promise<void>>
  sent: SentJob[]
  published: PublishedEvent[]
  /** Queues by event. */
  subscriptions: Map<string, Set<string>>
  schedules: Map<string, ScheduledJob>
  /**
   * Runs the registered worker on every job of `name` not run yet, ignoring `startAfter`, as
   * attempt `retryCount` (0 when absent).
   */
  run(name: string, attempt?: { retryCount?: number }): Promise<void>
}

/**
 * Records what is sent; it does not apply `startAfter`, `priority` or the queue's exclusivity, and
 * a published event is sent at once, even when its transaction later rolls back.
 */
export function memoryJobs(): MemoryJobs {
  let stopped = false
  const attemptOf = (name: string, id: string, retryCount: number): JobAttempt => ({
    id,
    retryCount,
    retryLimit: fake.queues.get(name)?.retryLimit ?? 0,
    signal: new AbortController().signal,
  })
  const done = new Set<string>()
  const fake: MemoryJobs = {
    queues: new Map(),
    workers: new Map(),
    sent: [],
    published: [],
    subscriptions: new Map(),
    schedules: new Map(),
    async defineQueue(name, policy) {
      fake.queues.set(name, {
        expireInSeconds: DEFAULT_EXPIRE_IN_SECONDS,
        exclusivity: 'standard',
        ...policy,
      })
    },
    async send(name, data, options = {}) {
      const id = randomUUID()
      fake.sent.push({ id, name, data, options })
      return id
    },
    async work(name, handler) {
      fake.workers.set(name, (data, attempt) =>
        handler(data as never, attempt ?? attemptOf(name, randomUUID(), 0)),
      )
    },
    async subscribe(event, queue) {
      const queues = fake.subscriptions.get(event) ?? new Set()
      fake.subscriptions.set(event, queues.add(queue))
    },
    async publish(event, data, options = {}) {
      fake.published.push({ event, data, options })
      for (const queue of fake.subscriptions.get(event) ?? []) await fake.send(queue, data)
    },
    async deadLetter(name, data) {
      await fake.send(deadLetterOf(name), data)
    },
    async schedule(name, cron, data, options = {}) {
      fake.schedules.set(name, { cron, data, options })
    },
    async unschedule(name) {
      fake.schedules.delete(name)
    },
    async run(name, { retryCount = 0 } = {}) {
      const worker = fake.workers.get(name)
      if (!worker) throw new Error(`no worker for ${name}`)
      for (const job of fake.sent) {
        if (job.name !== name || done.has(job.id)) continue
        await worker(job.data, attemptOf(name, job.id, retryCount))
        done.add(job.id)
      }
    },
    async probe() {
      if (stopped) throw new Error('[data] the job runner is stopped')
    },
    async stop() {
      stopped = true
    },
  }
  return fake
}
