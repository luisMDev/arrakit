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
import type { JobsRuntime } from './jobs/types'
import { forOrganization } from './organization/index'
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
}

function buildData(ctx: DataContext, close: () => Promise<void>, driver: 'postgres' | 'pglite') {
  return {
    driver,
    db: ctx.db,
    ...membershipData(ctx),
    ...onboardingData(ctx),
    ...organizationsData(ctx),
    ...invitationsData(ctx),
    ...accountData(ctx),
    forOrganization: (id: string) => forOrganization(ctx, id),
    jobs: ctx.jobs as JobsRuntime,
    storage: ctx.storage,
    authDatabase: authDatabase(ctx.db),
    health: () => health(ctx),
    close,
  }
}

export type Data = ReturnType<typeof buildData>

export async function openData(config: DataConfig, options: OpenDataOptions = {}): Promise<Data> {
  const connection = await connect(config)
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
        ? localStorage(config.storageDir)
        : memoryStorage())

  let jobs: JobsRuntime
  try {
    jobs =
      options.jobs ??
      (connection.driver === 'postgres' && config.databaseUrl
        ? await pgBossJobs(config.databaseUrl)
        : inProcessJobs())
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

  return buildData(
    { db: connection.db, jobs, storage, now: options.now ?? (() => new Date()) },
    close,
    connection.driver,
  )
}
