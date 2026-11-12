import { sql } from 'drizzle-orm'

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
import type { JobsRuntime } from './jobs/types'
import { assertMigrated } from './migrations'
import { forOrganization } from './organization/index'
import { type MemberClaims, systemClaims } from './organization/scoped'
import { memoryStorage } from './storage/memory'
import { supabaseStorage } from './storage/supabase'
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

async function health(ctx: DataContext): Promise<HealthReport> {
  const [postgres, storage, queue] = await Promise.all([
    probe(ctx, 'postgres', () => ctx.db.execute(sql`select 1`)),
    probe(ctx, 'storage', (signal) => ctx.storage.probe(signal)),
    probe(ctx, 'queue', (signal) => ctx.jobs.probe(signal)),
  ])
  const ok = postgres === 'up' && storage === 'up' && queue === 'up'
  return { status: ok ? 'ok' : 'error', postgres, storage, queue }
}

/**
 * Lookups that cross organizations by design (memberships, custom roles, invitations, accounts,
 * stalled tasks, pending files, organization lookups). They run as the connection's own role and
 * bypass RLS.
 */
const privilegedData = (ctx: DataContext) => ({
  ...membershipData(ctx),
  ...organizationsData(ctx),
  ...invitationsData(ctx),
  ...accountData(ctx),
  ...filesData(ctx),
  ...tasksData(ctx),
})

function buildData(ctx: DataContext, close: () => Promise<void>) {
  return {
    ...privilegedData(ctx),
    /** The scope of a person: every operation runs under RLS with their claims. */
    forOrganization: (claims: MemberClaims) => forOrganization(ctx, claims),
    /**
     * The scope of server work with no person behind it (workers, webhooks, auth hooks): every
     * operation still runs under RLS, confined to this one organization.
     */
    asSystem: (organizationId: string) => forOrganization(ctx, systemClaims(organizationId)),
    jobs: ctx.jobs,
    authDatabase: authDatabase(ctx.db),
    health: () => health(ctx),
    close,
  }
}

/**
 * The data layer app code should be typed against: organization data only through
 * forOrganization(claims) or asSystem(id), no raw database or bucket handle. Everything else on it
 * is privileged and crosses organizations by design.
 */
export type ScopedData = ReturnType<typeof buildData>

/** What openData() opens: ScopedData plus the raw handles, for packages/db and test set-up. */
export type Data = ScopedData & {
  db: DataContext['db']
  storage: Storage
}

/** Opens the data layer on Postgres, refusing a database whose migrations are behind. */
export async function openData(config: DataConfig, options: OpenDataOptions = {}): Promise<Data> {
  const connection = connect(config, options.log ?? consoleLog)
  try {
    await assertMigrated(connection.db)
  } catch (err) {
    await connection.close()
    throw err
  }
  return openDataOn(connection, config, options)
}

/** The data layer over an open, migrated database. */
export async function openDataOn(
  connection: Connection,
  config: Pick<DataConfig, 'storage'>,
  options: OpenDataOptions = {},
): Promise<Data> {
  const log = options.log ?? consoleLog

  const storage =
    options.storage ?? (config.storage ? supabaseStorage(config.storage) : memoryStorage())
  if (!options.storage && !config.storage) {
    log.info(
      'file storage is not configured (no SUPABASE_SECRET_KEY): uploads are kept in memory only',
    )
  }

  let jobs: JobsRuntime
  try {
    jobs = options.jobs ?? (await connection.openJobs(log))
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
  )
  return { ...data, db: connection.db, storage }
}
