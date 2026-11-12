import { type Jobs, STORAGE_PURGE_QUEUE, type SendOptions, WORKER_RETRY_POLICY } from '@arrakit/db'
import { z } from 'zod'

import type { Logger } from '../observability/logger'

import { defineJob, sendJob } from './job'

type StoragePurgeJob = { organizationId: string } & ({ folder: string } | { path: string })

const purgeFields = (job: StoragePurgeJob) => ({
  organizationId: job.organizationId,
  target:
    'path' in job ? `object "${job.path}"` : `folder "${job.folder === '' ? '<all>' : job.folder}"`,
})

export const storagePurge = defineJob({
  name: STORAGE_PURGE_QUEUE,
  schema: z.union([
    z.object({
      organizationId: z.guid(),
      /** A folder ending in `/`, or '' for the whole organization. */
      folder: z.string(),
    }),
    z.object({ organizationId: z.guid(), path: z.string().min(1) }),
  ]),
  policy: WORKER_RETRY_POLICY,
  async handler(job, { data }) {
    const objects = data.asSystem(job.organizationId).objects
    await ('path' in job ? objects.remove(job.path) : objects.removePrefix(job.folder))
  },
  logFields: purgeFields,
})

/** Queues a purge; a failure is logged and never thrown (the delete already succeeded). */
export async function queueStoragePurge(
  jobs: Jobs,
  job: StoragePurgeJob,
  log: Logger,
  options?: Pick<SendOptions, 'startAfter'>,
): Promise<void> {
  try {
    await sendJob(jobs, storagePurge, job, options)
  } catch (err) {
    log.error(
      { err, ...purgeFields(job) },
      'storage purge not queued; its files stay in the bucket',
    )
  }
}
