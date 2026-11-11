import { sql } from 'drizzle-orm'
import { fromPglite } from 'pg-boss'

import { authDatabase } from './auth-database'
import type { DataConfig } from './config'
import { type Connection, connect } from './connection'
import { type DataContext, type DataLog, consoleLog } from './context'
import { accountData } from './data/account'
import { filesData } from './data/files'
import { invitationsData } from './data/invitations'
import { membershipData } from './data/membership'
import { organizationsData } from './data/organizations'
import { tasksData } from './data/tasks'
import { pgBossJobs } from './jobs/pg-boss'
import type { JobsRuntime } from './jobs/types'
import { forOrganization } from './organization/index'
import { memoryStorage } from './storage/memory'
import { s3Storage } from './storage/s3'
import type { Storage } from './storage/types'
import { TASK_CHANNEL, type TaskFeed, pgliteTaskFeed, postgresTaskFeed } from './tasks/feed'

export interface OpenDataOptions {
  /** Replace the storage implementation (tests). */
  storage?: Storage
  /** Replace the jobs implementation (tests: memoryJobs()). */
  jobs?: JobsRuntime
  now?: () => Date
  /** Where recovered failures are reported (console when unset). */
  log?: DataLog
}

type ProbeState = 'up' | 'down'
export interface HealthReport {
  status: 'ok' | 'error'
  postgres: ProbeState
  storage: ProbeState
  queue: ProbeState
  /** Whether task changes reach the task feed (live task updates). */
  taskFeed: ProbeState
}

const PROBE_TIMEOUT_MS = 3000

async function probe(
  ctx: DataContext,
  name: string,
  run: (signal: AbortSignal) => Promise<unknown>,
): Promise<ProbeState> {
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS)
  const timeout = new Promise<never>((_, reject) =>
    signal.addEventListener('abort', () =>
      reject(new Error(`timed out after ${PROBE_TIMEOUT_MS} ms`)),
    ),
  )
  try {
    await Promise.race([run(signal), timeout])
    return 'up'
  } catch (err) {
    ctx.log.error({ err, probe: name }, 'health probe down')
    return 'down'
  }
}

/** Sends a test notice through the connection task changes are written on. */
const probeTaskFeed = (ctx: DataContext, taskFeed: TaskFeed) =>
  taskFeed.probe((payload) => ctx.db.execute(sql`select pg_notify(${TASK_CHANNEL}, ${payload})`))

export async function health(ctx: DataContext, taskFeed: TaskFeed): Promise<HealthReport> {
  const [postgres, storage, queue, feed] = await Promise.all([
    probe(ctx, 'postgres', () => ctx.db.execute(sql`select 1`)),
    probe(ctx, 'storage', (signal) => ctx.storage.probe(signal)),
    probe(ctx, 'queue', (signal) => ctx.jobs.probe(signal)),
    probe(ctx, 'taskFeed', () => probeTaskFeed(ctx, taskFeed)),
  ])
  const ok = postgres === 'up' && storage === 'up' && queue === 'up' && feed === 'up'
  return { status: ok ? 'ok' : 'error', postgres, storage, queue, taskFeed: feed }
}

function buildData(
  ctx: DataContext,
  close: () => Promise<void>,
  driver: 'postgres' | 'pglite',
  taskFeed: TaskFeed,
) {
  return {
    driver,
    ...membershipData(ctx),
    ...organizationsData(ctx),
    ...invitationsData(ctx),
    ...accountData(ctx),
    ...filesData(ctx),
    ...tasksData(ctx),
    forOrganization: (id: string) => forOrganization(ctx, id),
    jobs: ctx.jobs,
    /** Changes to tasks as they commit. */
    taskFeed: {
      subscribe: taskFeed.subscribe,
      /** Rejects with what to fix when task changes do not reach the feed. */
      probe: () => probeTaskFeed(ctx, taskFeed),
    },
    authDatabase: authDatabase(ctx.db),
    health: () => health(ctx, taskFeed),
    close,
  }
}

/**
 * The data layer app code should be typed against: organization data only through
 * forOrganization(id), no raw database or bucket handle.
 */
export type ScopedData = ReturnType<typeof buildData>

/** What openData() opens: ScopedData plus the raw handles, for packages/db and test set-up. */
export type Data = ScopedData & {
  db: DataContext['db']
  storage: Storage
}

/** pg-boss on the same database: the Postgres URL, or the PGlite instance Drizzle uses. */
function pgBossOn(connection: Connection, config: DataConfig, log: DataLog): Promise<JobsRuntime> {
  if (connection.pglite) {
    return pgBossJobs({ db: fromPglite(connection.pglite), backend: 'pglite' }, log)
  }
  return pgBossJobs(config.databaseUrl!, log)
}

export async function openData(config: DataConfig, options: OpenDataOptions = {}): Promise<Data> {
  const log = options.log ?? consoleLog
  const connection = await connect(config, log)
  try {
    await connection.migrate()
  } catch (err) {
    await connection.close()
    throw err
  }

  const bucket = !options.storage && config.s3 ? s3Storage(config.s3) : undefined
  const storage = options.storage ?? bucket ?? memoryStorage()
  if (!options.storage && !config.s3) {
    log.info('file storage is not configured (no R2_*): uploads are kept in memory only')
  }
  try {
    if (config.s3?.localBucket) await bucket?.prepareLocalBucket()
  } catch (err) {
    await storage.close()
    await connection.close()
    throw err
  }

  let jobs: JobsRuntime
  try {
    jobs = options.jobs ?? (await pgBossOn(connection, config, log))
  } catch (err) {
    await storage.close()
    await connection.close()
    throw err
  }

  const taskFeed = connection.pglite
    ? pgliteTaskFeed(connection.pglite, log)
    : postgresTaskFeed((config.databaseDirectUrl ?? config.databaseUrl)!, log)

  let closing: Promise<void> | undefined
  const close = () => {
    closing ??= (async () => {
      try {
        await taskFeed.close()
        await jobs.stop()
      } finally {
        await storage.close()
        await connection.close()
      }
    })()
    return closing
  }

  const data = buildData(
    { db: connection.db, jobs, storage, now: options.now ?? (() => new Date()), log },
    close,
    connection.driver,
    taskFeed,
  )
  return { ...data, db: connection.db, storage }
}
