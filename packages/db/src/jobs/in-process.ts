import { randomUUID } from 'node:crypto'

import type { DataLog } from '../log'
import {
  DEFAULT_EXPIRE_IN_SECONDS,
  type JobsRuntime,
  type RetryPolicy,
  deadLetterOf,
} from './types'

interface StoredJob {
  id: string
  name: string
  data: object
  state: 'created' | 'retry' | 'active' | 'completed' | 'failed'
  retries: number
  startAfter: number
}

const DEFAULT_POLICY: Required<RetryPolicy> = {
  retryLimit: 2,
  retryDelay: 0,
  retryBackoff: false,
  expireInSeconds: DEFAULT_EXPIRE_IN_SECONDS,
}

export function inProcessJobs(options: {
  log: DataLog
  now?: () => number
  pollingIntervalSeconds?: number
}): JobsRuntime {
  const now = options.now ?? Date.now
  const pollingMs = (options.pollingIntervalSeconds ?? 2) * 1000
  const { log } = options
  const queues = new Map<string, Required<RetryPolicy>>()
  const jobs = new Map<string, StoredJob>()
  const timers = new Set<ReturnType<typeof setInterval>>()
  const running = new Set<Promise<void>>()
  let stopped = false
  let stopping: Promise<void> | undefined

  function assertRunning() {
    if (stopped) throw new Error('[data] the job runner is stopped')
  }

  function enqueue(name: string, data: object) {
    const id = randomUUID()
    jobs.set(id, { id, name, data, state: 'created', retries: 0, startAfter: now() })
    return id
  }

  async function runOne(job: StoredJob, handler: (data: object) => Promise<void>) {
    const policy = queues.get(job.name) ?? DEFAULT_POLICY
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
    async defineQueue(name, policy) {
      assertRunning()
      if (!queues.has(deadLetterOf(name))) queues.set(deadLetterOf(name), DEFAULT_POLICY)
      if (!queues.has(name)) {
        queues.set(name, { expireInSeconds: DEFAULT_EXPIRE_IN_SECONDS, ...policy })
      }
    },
    async send(name, data) {
      assertRunning()
      return enqueue(name, data)
    },
    async work(name, handler) {
      assertRunning()
      const tick = () => poll(name, handler as (data: object) => Promise<void>)
      const timer = setInterval(tick, pollingMs)
      timer.unref?.()
      timers.add(timer)
      queueMicrotask(tick)
    },
    async probe() {
      assertRunning()
    },
    stop() {
      stopping ??= (async () => {
        stopped = true
        for (const timer of timers) clearInterval(timer)
        await Promise.allSettled([...running])
      })()
      return stopping
    },
  }
}
