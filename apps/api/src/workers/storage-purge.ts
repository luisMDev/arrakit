import { type Data, type Jobs, WORKER_RETRY_POLICY } from '@arrakit/db'

export const STORAGE_PURGE = 'storage-purge'

export type StoragePurgeJob = { organizationId: string } & ({ folder: string } | { keys: string[] })

const target = (job: StoragePurgeJob) =>
  'keys' in job
    ? `files ${job.keys.join(', ')}`
    : `folder "${job.folder === '' ? '<all>' : job.folder}"`

export async function registerStoragePurge(data: Data): Promise<void> {
  await data.jobs.defineQueue(STORAGE_PURGE, WORKER_RETRY_POLICY)
  await data.jobs.work<StoragePurgeJob>(STORAGE_PURGE, async (job) => {
    try {
      const files = data.forOrganization(job.organizationId).files
      if ('keys' in job) await files.remove(job.keys)
      else await files.removePrefix(job.folder)
    } catch (err) {
      console.error(
        `organization ${job.organizationId} ${target(job)}: purge failed; pg-boss retries it, then dead-letters it`,
        err,
      )
      throw err
    }
  })
}

/** Queues a purge; a failure is logged and never thrown (the delete already succeeded). */
export async function queueStoragePurge(jobs: Jobs, job: StoragePurgeJob): Promise<void> {
  try {
    await jobs.send(STORAGE_PURGE, job)
  } catch (err) {
    console.error(
      `organization ${job.organizationId} ${target(job)}: deleted, but its storage purge was not queued; its files stay in the bucket`,
      err,
    )
  }
}
