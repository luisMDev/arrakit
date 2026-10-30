import { type ScopedData, type Jobs, WORKER_RETRY_POLICY } from '@arrakit/db'

import type { Logger } from '../observability/logger'

export const STORAGE_PURGE = 'storage-purge'

interface StoragePurgeJob {
  organizationId: string
  folder: string
}

const target = (job: StoragePurgeJob) => `folder "${job.folder === '' ? '<all>' : job.folder}"`

export async function registerStoragePurge(data: ScopedData, log: Logger): Promise<void> {
  await data.jobs.defineQueue(STORAGE_PURGE, WORKER_RETRY_POLICY)
  await data.jobs.work<StoragePurgeJob>(STORAGE_PURGE, async (job) => {
    try {
      await data.forOrganization(job.organizationId).files.removePrefix(job.folder)
    } catch (err) {
      log.error(
        { err, organizationId: job.organizationId, target: target(job) },
        'storage purge failed; the queue retries it, then dead-letters it',
      )
      throw err
    }
  })
}

/** Queues a purge; a failure is logged and never thrown (the delete already succeeded). */
export async function queueStoragePurge(
  jobs: Jobs,
  job: StoragePurgeJob,
  log: Logger,
): Promise<void> {
  try {
    await jobs.send(STORAGE_PURGE, job)
  } catch (err) {
    log.error(
      { err, organizationId: job.organizationId, target: target(job) },
      'storage purge not queued; its files stay in the bucket',
    )
  }
}
