import { randomUUID } from 'node:crypto'

import {
  DEFAULT_EXPIRE_IN_SECONDS,
  type JobRecord,
  type JobsRuntime,
  type RetryPolicy,
} from './types'

export interface SentJob {
  id: string
  name: string
  data: object
  startAfter?: Date
  key?: string
  at: Date
}

export interface MemoryJobs extends JobsRuntime {
  queues: Map<string, Required<RetryPolicy>>
  exclusive: Set<string>
  workers: Map<string, (data: object) => Promise<void>>
  sent: SentJob[]
  schedules: Map<string, { cron: string; data: object }>
  stored: Map<string, JobRecord & { name: string; key?: string }>
  moveJob(id: string, state: JobRecord['state']): void
  /** Runs the registered worker on every stored job of `name` still created. */
  run(name: string): Promise<void>
}

export function memoryJobs(): MemoryJobs {
  const fake: MemoryJobs = {
    kind: 'memory',
    queues: new Map(),
    exclusive: new Set(),
    workers: new Map(),
    sent: [],
    schedules: new Map(),
    stored: new Map(),
    async defineQueue(name, policy, opts = {}) {
      fake.queues.set(name, { expireInSeconds: DEFAULT_EXPIRE_IN_SECONDS, ...policy })
      if (opts.exclusive) fake.exclusive.add(name)
    },
    async send(name, data, opts = {}) {
      const id = randomUUID()
      fake.sent.push({ id, name, data, startAfter: opts.startAfter, at: new Date() })
      fake.stored.set(id, { id, name, data, state: 'created' })
      return id
    },
    async sendOnce(name, data, key, opts = {}) {
      for (const job of fake.stored.values()) {
        if (
          job.name === name &&
          job.key === key &&
          ['created', 'retry', 'active'].includes(job.state)
        ) {
          return false
        }
      }
      const id = randomUUID()
      fake.sent.push({ id, name, data, key, startAfter: opts.startAfter, at: new Date() })
      fake.stored.set(id, { id, name, data, key, state: 'created' })
      return true
    },
    async schedule(name, cron, data) {
      fake.schedules.set(name, { cron, data })
    },
    async work(name, handler) {
      fake.workers.set(name, handler as (data: object) => Promise<void>)
    },
    async find(name, filter = {}) {
      return [...fake.stored.values()]
        .filter((job) => job.name === name && (!filter.id || job.id === filter.id))
        .map(({ id, state, data }) => ({ id, state, data }))
    },
    async queuePolicy(name) {
      return fake.queues.get(name)
    },
    moveJob(id, state) {
      const job = fake.stored.get(id)
      if (job) job.state = state
    },
    async run(name) {
      const worker = fake.workers.get(name)
      if (!worker) throw new Error(`no worker for ${name}`)
      for (const job of fake.stored.values()) {
        if (job.name !== name || job.state !== 'created') continue
        await worker(job.data)
        job.state = 'completed'
      }
    },
    async probe() {},
    async stop() {},
  }
  return fake
}

/** Jobs sent to `name`, optionally only for one organization and after `since`. */
export function sentJobs(
  jobs: MemoryJobs,
  filter: { name: string; organizationId?: string; since?: Date },
): SentJob[] {
  return jobs.sent.filter(
    (job) =>
      job.name === filter.name &&
      (!filter.organizationId ||
        (job.data as { organizationId?: string }).organizationId === filter.organizationId) &&
      (!filter.since || job.at >= filter.since),
  )
}
