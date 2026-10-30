import { type ConstructorOptions, PgBoss } from 'pg-boss'

import type { DataLog } from '../log'
import { DEFAULT_EXPIRE_IN_SECONDS, type JobsRuntime, deadLetterOf } from './types'

/**
 * pg-boss in its own `pgboss` schema. `source` is a Postgres URL, or pg-boss constructor options
 * (tests run the same code on PGlite through `{ db: fromPglite(pg), backend: 'pglite' }`).
 */
export async function pgBossJobs(
  source: string | ConstructorOptions,
  log: DataLog,
): Promise<JobsRuntime> {
  const options = typeof source === 'string' ? { connectionString: source } : source
  const boss = new PgBoss({ schema: 'pgboss', ...options })
  boss.on('error', (err) => log.error({ err }, 'pg-boss failed'))
  await boss.start()
  await boss.createQueue('health')
  let stopped: Promise<void> | undefined

  return {
    kind: 'pg-boss',
    async defineQueue(name, policy) {
      const dead = deadLetterOf(name)
      if (!(await boss.getQueue(dead))) await boss.createQueue(dead)
      if (await boss.getQueue(name)) return
      await boss.createQueue(name, {
        retryLimit: policy.retryLimit,
        retryDelay: policy.retryDelay,
        retryBackoff: policy.retryBackoff,
        expireInSeconds: policy.expireInSeconds ?? DEFAULT_EXPIRE_IN_SECONDS,
        deadLetter: dead,
      })
    },
    async send(name, data) {
      const id = await boss.send(name, data)
      if (!id) throw new Error(`[data] pg-boss did not queue a job on ${name}`)
      return id
    },
    async work(name, handler) {
      await boss.work<object>(name, { pollingIntervalSeconds: 2, batchSize: 1 }, async (jobs) => {
        for (const job of jobs) await handler(job.data as never)
      })
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
