import { randomUUID } from 'node:crypto'

import { Cron } from 'croner'

import type { DataLog } from '../log'
import {
  DEFAULT_EXPIRE_IN_SECONDS,
  type JobRecord,
  type JobsRuntime,
  type RetryPolicy,
  type SendOptions,
  deadLetterOf,
} from './types'

interface StoredJob extends JobRecord {
  name: string
  key?: string
  retries: number
  startAfter: number
}

interface Queue {
  policy: Required<RetryPolicy>
  exclusive: boolean
}

const DEFAULT_POLICY: Required<RetryPolicy> = {
  retryLimit: 2,
  retryDelay: 0,
  retryBackoff: false,
  expireInSeconds: DEFAULT_EXPIRE_IN_SECONDS,
}

export function inProcessJobs(options: { log: DataLog; now?: () => number }): JobsRuntime {
  const now = options.now ?? Date.now
  const { log } = options
  const queues = new Map<string, Queue>()
  const jobs = new Map<string, StoredJob>()
  const timers = new Set<ReturnType<typeof setInterval>>()
  const crons = new Map<string, Cron>()
  const running = new Set<Promise<void>>()
  let stopped = false
  let stopping: Promise<void> | undefined

  const queueOf = (name: string) => queues.get(name) ?? { policy: DEFAULT_POLICY, exclusive: false }

  function assertRunning() {
    if (stopped) throw new Error('[data] the job runner is stopped')
  }

  function enqueue(
    name: string,
    data: object,
    opts: SendOptions & { key?: string; id?: string } = {},
  ) {
    const id = opts.id ?? randomUUID()
    jobs.set(id, {
      id,
      name,
      data,
      state: 'created',
      key: opts.key,
      retries: 0,
      startAfter: opts.startAfter?.getTime() ?? now(),
    })
    return id
  }

  async function runOne(job: StoredJob, handler: (data: object) => Promise<void>) {
    const { policy } = queueOf(job.name)
    job.state = 'active'
    try {
      await handler(job.data)
      job.state = 'completed'
    } catch (err) {
      if (job.retries < policy.retryLimit) {
        job.retries += 1
        const factor = policy.retryBackoff ? 2 ** (job.retries - 1) : 1
        job.startAfter = now() + policy.retryDelay * 1000 * factor
        job.state = 'retry'
      } else {
        job.state = 'failed'
        log.error({ err, jobId: job.id, queue: job.name }, 'job failed for good')
        if (queues.has(deadLetterOf(job.name))) enqueue(deadLetterOf(job.name), job.data)
      }
    }
  }

  function poll(name: string, handler: (data: object) => Promise<void>) {
    if (stopped) return
    for (const job of jobs.values()) {
      if (job.name !== name) continue
      if (job.state !== 'created' && job.state !== 'retry') continue
      if (job.startAfter > now()) continue
      const run = runOne(job, handler).finally(() => running.delete(run))
      running.add(run)
    }
  }

  return {
    kind: 'in-process',
    async defineQueue(name, policy, opts = {}) {
      assertRunning()
      const full = { expireInSeconds: DEFAULT_EXPIRE_IN_SECONDS, ...policy }
      if (!queues.has(deadLetterOf(name)))
        queues.set(deadLetterOf(name), { policy: DEFAULT_POLICY, exclusive: false })
      const existing = queues.get(name)
      if (opts.exclusive && existing && !existing.exclusive) {
        throw new Error(
          `[data] queue ${name} exists with policy standard, not exclusive; pg-boss cannot change it`,
        )
      }
      // Like pg-boss: an existing queue keeps the policy it was created with.
      if (!existing) queues.set(name, { policy: full, exclusive: opts.exclusive ?? false })
    },
    async send(name, data, opts) {
      assertRunning()
      return enqueue(name, data, opts)
    },
    async sendWithId(id, name, data, opts) {
      assertRunning()
      return enqueue(name, data, { ...opts, id })
    },
    async sendOnce(name, data, key, opts) {
      assertRunning()
      for (const job of jobs.values()) {
        if (
          job.name === name &&
          job.key === key &&
          ['created', 'retry', 'active'].includes(job.state)
        ) {
          return false
        }
      }
      enqueue(name, data, { ...opts, key })
      return true
    },
    async schedule(name, cron, data) {
      assertRunning()
      crons.get(name)?.stop()
      crons.set(name, new Cron(cron, { timezone: 'UTC' }, () => void enqueue(name, data)))
    },
    async work(name, handler, opts = {}) {
      assertRunning()
      const interval = (opts.pollingIntervalSeconds ?? 2) * 1000
      const tick = () => poll(name, handler as (data: object) => Promise<void>)
      const timer = setInterval(tick, interval)
      timer.unref?.()
      timers.add(timer)
      queueMicrotask(tick)
    },
    async find(name, filter = {}) {
      return [...jobs.values()]
        .filter((job) => job.name === name && (!filter.id || job.id === filter.id))
        .map(({ id, state, data }) => ({ id, state, data }))
    },
    async queuePolicy(name) {
      return queues.get(name)?.policy
    },
    async probe() {
      assertRunning()
    },
    stop() {
      stopping ??= (async () => {
        stopped = true
        for (const timer of timers) clearInterval(timer)
        for (const cron of crons.values()) cron.stop()
        await Promise.allSettled([...running])
      })()
      return stopping
    },
  }
}
