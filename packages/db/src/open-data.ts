import { sql } from 'drizzle-orm'

import { authDatabase } from './auth-database'
import type { DataConfig } from './config'
import { connect } from './connection'
import { type DataContext, type DataLog, consoleLog } from './context'
import { accountData } from './data/account'
import { invitationsData } from './data/invitations'
import { membershipData } from './data/membership'
import { organizationsData } from './data/organizations'
import { inProcessJobs } from './jobs/in-process'
import { pgBossJobs } from './jobs/pg-boss'
import type { JobsRuntime } from './jobs/types'
import { forOrganization } from './organization/index'
import { memoryStorage } from './storage/memory'
import { s3Storage } from './storage/s3'
import type { Storage } from './storage/types'

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

export async function health(ctx: DataContext): Promise<HealthReport> {
  const [postgres, storage, queue] = await Promise.all([
    probe(ctx, 'postgres', () => ctx.db.execute(sql`select 1`)),
    probe(ctx, 'storage', (signal) => ctx.storage.probe(signal)),
    probe(ctx, 'queue', (signal) => ctx.jobs.probe(signal)),
  ])
  const ok = postgres === 'up' && storage === 'up' && queue === 'up'
  return { status: ok ? 'ok' : 'error', postgres, storage, queue }
}

function buildData(ctx: DataContext, close: () => Promise<void>, driver: 'postgres' | 'pglite') {
  return {
    driver,
    ...membershipData(ctx),
    ...organizationsData(ctx),
    ...invitationsData(ctx),
    ...accountData(ctx),
    forOrganization: (id: string) => forOrganization(ctx, id),
    jobs: ctx.jobs,
    authDatabase: authDatabase(ctx.db),
    health: () => health(ctx),
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

export async function openData(config: DataConfig, options: OpenDataOptions = {}): Promise<Data> {
  const log = options.log ?? consoleLog
  const connection = await connect(config, log)
  try {
    await connection.migrate()
  } catch (err) {
    await connection.close()
    throw err
  }

  const storage = options.storage ?? (config.s3 ? s3Storage(config.s3) : memoryStorage())

  let jobs: JobsRuntime
  try {
    jobs =
      options.jobs ??
      (connection.driver === 'postgres' && config.databaseUrl
        ? await pgBossJobs(config.databaseUrl, log)
        : inProcessJobs({ log }))
  } catch (err) {
    await storage.close()
    await connection.close()
    throw err
  }

  let closing: Promise<void> | undefined
  const close = () => {
    closing ??= (async () => {
      try {
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
  )
  return { ...data, db: connection.db, storage }
}
