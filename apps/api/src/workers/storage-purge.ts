import { type Jobs, WORKER_RETRY_POLICY } from '@arrakit/db'
import { z } from 'zod'

import type { Logger } from '../observability/logger'

import { defineJob, sendJob } from './job'

interface StoragePurgeJob {
  organizationId: string
  folder: string
}

const purgeFields = ({ organizationId, folder }: StoragePurgeJob) => ({
  organizationId,
  target: `folder "${folder === '' ? '<all>' : folder}"`,
})

export const storagePurge = defineJob({
  name: 'storage-purge',
  schema: z.object({
    organizationId: z.guid(),
    /** A folder ending in `/`, or '' for the whole organization. */
    folder: z.string(),
  }),
  policy: WORKER_RETRY_POLICY,
  async handler({ organizationId, folder }, { data }) {
    await data.forOrganization(organizationId).objects.removePrefix(folder)
  },
  logFields: purgeFields,
})

/** Queues a purge; a failure is logged and never thrown (the delete already succeeded). */
export async function queueStoragePurge(
  jobs: Jobs,
  job: StoragePurgeJob,
  log: Logger,
): Promise<void> {
  try {
    await sendJob(jobs, storagePurge, job)
  } catch (err) {
    log.error(
      { err, ...purgeFields(job) },
      'storage purge not queued; its files stay in the bucket',
    )
  }
}
