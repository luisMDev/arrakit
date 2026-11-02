import { randomUUID } from 'node:crypto'

import {
  DEFAULT_EXPIRE_IN_SECONDS,
  deadLetterOf,
  type JobsRuntime,
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

export interface ScheduledJob {
  cron: string
  data: object
  options: ScheduleOptions
}

export interface MemoryJobs extends JobsRuntime {
  queues: Map<string, Required<QueuePolicy>>
  workers: Map<string, (data: object) => Promise<void>>
  sent: SentJob[]
  schedules: Map<string, ScheduledJob>
  /** Runs the registered worker on every job of `name` not run yet, ignoring `startAfter`. */
  run(name: string): Promise<void>
}

/** Records what is sent; it does not apply `startAfter`, `priority` or the queue's exclusivity. */
export function memoryJobs(): MemoryJobs {
  let stopped = false
  const done = new Set<string>()
  const fake: MemoryJobs = {
    queues: new Map(),
    workers: new Map(),
    sent: [],
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
      fake.workers.set(name, handler as (data: object) => Promise<void>)
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
    async run(name) {
      const worker = fake.workers.get(name)
      if (!worker) throw new Error(`no worker for ${name}`)
      for (const job of fake.sent) {
        if (job.name !== name || done.has(job.id)) continue
        await worker(job.data)
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
