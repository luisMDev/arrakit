import { authDatabase } from './auth-database'
import type { DataConfig } from './config'
import { connect } from './connection'
import type { DataContext } from './context'
import { accountData } from './data/account'
import { invitationsData } from './data/invitations'
import { membershipData } from './data/membership'
import { onboardingData } from './data/onboarding'
import { organizationsData } from './data/organizations'
import { health } from './health'
import { inProcessJobs } from './jobs/in-process'
import { pgBossJobs } from './jobs/pg-boss'
import { transactionWithJobs } from './jobs/transaction'
import type { JobsRuntime, TransactionWithJobs } from './jobs/types'
import { forOrganization } from './organization/index'
import { type DataLog, consoleLog } from './log'
import { localStorage } from './storage/local'
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

function buildData(ctx: DataContext, close: () => Promise<void>, driver: 'postgres' | 'pglite') {
  return {
    driver,
    ...membershipData(ctx),
    ...onboardingData(ctx),
    ...organizationsData(ctx),
    ...invitationsData(ctx),
    ...accountData(ctx),
    forOrganization: (id: string) => forOrganization(ctx, id),
    jobs: ctx.jobs as JobsRuntime,
    /** The storage fallback's presigned URLs (undefined on S3, which serves its own). */
    serveSignedFile: ctx.storage.serveSigned?.bind(ctx.storage),
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
  transactionWithJobs: TransactionWithJobs
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

  const storage =
    options.storage ??
    (config.s3
      ? s3Storage(config.s3)
      : config.storageDir
        ? localStorage(config.storageDir, { signing: config.storageSigning })
        : memoryStorage())

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

  const withJobs = transactionWithJobs(connection.db, jobs)
  const data = buildData(
    { db: connection.db, jobs, storage, now: options.now ?? (() => new Date()), log },
    close,
    connection.driver,
  )
  return { ...data, db: connection.db, storage, transactionWithJobs: withJobs }
}
