import { randomUUID } from 'node:crypto'

import { DEFAULT_EXPIRE_IN_SECONDS, type JobsRuntime, type RetryPolicy } from './types'

export interface SentJob {
  id: string
  name: string
  data: object
  at: Date
}

export interface MemoryJobs extends JobsRuntime {
  queues: Map<string, Required<RetryPolicy>>
  workers: Map<string, (data: object) => Promise<void>>
  sent: SentJob[]
  /** Runs the registered worker on every job of `name` not run yet. */
  run(name: string): Promise<void>
}

export function memoryJobs(): MemoryJobs {
  let stopped = false
  const done = new Set<string>()
  const fake: MemoryJobs = {
    kind: 'memory',
    queues: new Map(),
    workers: new Map(),
    sent: [],
    async defineQueue(name, policy) {
      fake.queues.set(name, { expireInSeconds: DEFAULT_EXPIRE_IN_SECONDS, ...policy })
    },
    async send(name, data) {
      const id = randomUUID()
      fake.sent.push({ id, name, data, at: new Date() })
      return id
    },
    async work(name, handler) {
      fake.workers.set(name, handler as (data: object) => Promise<void>)
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
