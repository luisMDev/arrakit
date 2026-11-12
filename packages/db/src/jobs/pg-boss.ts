import { sql } from 'drizzle-orm'
import { type ConstructorOptions, PgBoss, fromDrizzle } from 'pg-boss'

import type { Database } from '../connection'
import type { DataLog } from '../context'
import { DEFAULT_EXPIRE_IN_SECONDS, type JobsRuntime, deadLetterOf } from './types'

// Drizzle types execute()'s rows as unknown; pg-boss's adapter reads them as rows.
type DrizzleTransaction = Parameters<typeof fromDrizzle>[0]
type TransactionAdapter = ReturnType<typeof fromDrizzle>

/**
 * Runs pg-boss's own statements in `tx` under the connection's own role, then restores the role
 * `tx` had. A scoped transaction runs as `authenticated`, which has no privilege on the pgboss
 * schema; the reset covers only `work`, so RLS applies again to the next statement.
 */
async function withOwnRole<R>(
  tx: Database,
  work: (adapter: TransactionAdapter) => Promise<R>,
): Promise<R> {
  const adapter = fromDrizzle(tx as DrizzleTransaction, sql)
  const { rows } = await adapter.executeSql("select current_setting('role') as role", [])
  const [{ role }] = rows as [{ role: string }]
  if (role === 'none') return work(adapter)
  await adapter.executeSql("select set_config('role', 'none', true)", [])
  let result: R
  try {
    result = await work(adapter)
  } catch (err) {
    // A failed statement aborts the transaction (or savepoint), whose rollback restores the role.
    await adapter.executeSql("select set_config('role', $1, true)", [role]).catch(() => {})
    throw err
  }
  await adapter.executeSql("select set_config('role', $1, true)", [role])
  return result
}

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
    async defineQueue(name, policy) {
      const dead = deadLetterOf(name)
      const [deadQueue, queue] = await Promise.all([boss.getQueue(dead), boss.getQueue(name)])
      if (!deadQueue) await boss.createQueue(dead)
      if (queue) return
      await boss.createQueue(name, {
        retryLimit: policy.retryLimit,
        retryDelay: policy.retryDelay,
        retryBackoff: policy.retryBackoff,
        expireInSeconds: policy.expireInSeconds ?? DEFAULT_EXPIRE_IN_SECONDS,
        policy: policy.exclusivity ?? 'standard',
        deadLetter: dead,
      })
    },
    async send(name, data, { tx, ...options } = {}) {
      const id = tx
        ? await withOwnRole(tx, (db) => boss.send(name, data, { ...options, db }))
        : await boss.send(name, data, options)
      if (!id && !options.singletonKey) {
        throw new Error(`[data] pg-boss did not queue a job on ${name}`)
      }
      return id
    },
    async work(name, handler) {
      const options = { pollingIntervalSeconds: 2, batchSize: 1, includeMetadata: true } as const
      await boss.work<object, unknown, typeof options>(name, options, async (jobs) => {
        for (const { id, data, retryCount, retryLimit, signal } of jobs) {
          await handler(data as never, { id, retryCount, retryLimit, signal })
        }
      })
    },
    async subscribe(event, queue) {
      await boss.subscribe(event, queue)
    },
    async publish(event, data, { tx } = {}) {
      if (!tx) return boss.publish(event, data)
      // boss.publish() reads the subscriptions on its own connection, which waits forever behind
      // an open transaction on PGlite's single one; read them and send through the transaction.
      await withOwnRole(tx, async (db) => {
        const { rows } = await db.executeSql(
          'SELECT name FROM pgboss.subscription WHERE event = $1 ORDER BY name',
          [event],
        )
        for (const { name } of rows as { name: string }[]) await boss.send(name, data, { db })
      })
    },
    async deadLetter(name, data) {
      await boss.send(deadLetterOf(name), data)
    },
    async schedule(name, cron, data, options) {
      await boss.schedule(name, cron, data, options)
    },
    async unschedule(name) {
      await boss.unschedule(name)
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
