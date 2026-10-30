import { type ConstructorOptions, PgBoss } from 'pg-boss'

import { DEFAULT_EXPIRE_IN_SECONDS, type JobRecord, type JobsRuntime, deadLetterOf } from './types'

/**
 * pg-boss in its own `pgboss` schema. `source` is a Postgres URL, or pg-boss constructor options
 * (tests run the same code on PGlite through `{ db: fromPglite(pg), backend: 'pglite' }`).
 */
export async function pgBossJobs(source: string | ConstructorOptions): Promise<JobsRuntime> {
  const options = typeof source === 'string' ? { connectionString: source } : source
  const boss = new PgBoss({ schema: 'pgboss', ...options })
  boss.on('error', (err) => console.error('[data] pg-boss:', err))
  await boss.start()
  await boss.createQueue('health')
  let stopped: Promise<void> | undefined

  return {
    kind: 'pg-boss',
    async defineQueue(name, policy, opts = {}) {
      const dead = deadLetterOf(name)
      if (!(await boss.getQueue(dead))) await boss.createQueue(dead)
      const options = {
        retryLimit: policy.retryLimit,
        retryDelay: policy.retryDelay,
        retryBackoff: policy.retryBackoff,
        expireInSeconds: policy.expireInSeconds ?? DEFAULT_EXPIRE_IN_SECONDS,
        deadLetter: dead,
      }
      const existing = await boss.getQueue(name)
      if (!existing) {
        await boss.createQueue(name, {
          ...options,
          policy: opts.exclusive ? 'exclusive' : 'standard',
        })
        return
      }
      // An existing queue keeps the policy it was created with (pg-boss createQueue semantics):
      // another process defining it with other numbers must not rewrite its retries.
      if (opts.exclusive && existing.policy !== 'exclusive') {
        throw new Error(
          `[data] queue ${name} exists with policy ${existing.policy}, not exclusive; pg-boss cannot change it`,
        )
      }
    },
    async send(name, data, opts = {}) {
      const id = await boss.send(name, data, { startAfter: opts.startAfter })
      if (!id) throw new Error(`[data] pg-boss did not queue a job on ${name}`)
      return id
    },
    async sendOnce(name, data, key, opts = {}) {
      const id = await boss.send(name, data, { singletonKey: key, startAfter: opts.startAfter })
      return id !== null
    },
    async schedule(name, cron, data) {
      // pg-boss skips missed ticks by default; the contract (types.ts) is "missed ticks run once".
      await boss.schedule(name, cron, data, { tz: 'UTC', missed: 'once' })
    },
    async work(name, handler, opts = {}) {
      await boss.work<object>(
        name,
        { pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 2, batchSize: 1 },
        async (jobs) => {
          for (const job of jobs) await handler(job.data as never)
        },
      )
    },
    async find(name, filter = {}) {
      const found = await boss.findJobs<object>(name, filter.id ? { id: filter.id } : {})
      return found.map((job): JobRecord => ({ id: job.id, state: job.state, data: job.data }))
    },
    async queuePolicy(name) {
      const queue = await boss.getQueue(name)
      if (!queue) return undefined
      return {
        retryLimit: queue.retryLimit ?? 0,
        retryDelay: queue.retryDelay ?? 0,
        retryBackoff: queue.retryBackoff ?? false,
        expireInSeconds: queue.expireInSeconds ?? DEFAULT_EXPIRE_IN_SECONDS,
      }
    },
    async probe() {
      if (stopped) throw new Error('[data] pg-boss is stopped')
      if (!(await boss.getQueue('health'))) throw new Error('[data] pg-boss has no health queue')
    },
    stop() {
      stopped ??= boss.stop({ graceful: true })
      return stopped
    },
  }
}
