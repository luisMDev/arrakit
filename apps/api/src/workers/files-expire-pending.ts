import { LATE_UPLOAD_SECONDS, WORKER_RETRY_POLICY } from '@arrakit/db'
import { z } from 'zod'

import { removeFileObject } from '../files/files'
import { defineJob } from './job'

/**
 * An upload link cannot be revoked, so a pending file must outlive its link: otherwise a late
 * upload would leave bytes with no row.
 */
export const PENDING_UPLOAD_TTL_SECONDS = LATE_UPLOAD_SECONDS

/** Drops uploads never completed, freeing their storage quota and removing any bytes sent. */
export const filesExpirePending = defineJob({
  name: 'files-expire-pending',
  schema: z.object({}),
  policy: WORKER_RETRY_POLICY,
  schedule: { cron: '*/15 * * * *', data: {} },
  async handler(_payload, { data, log }) {
    const before = new Date(Date.now() - PENDING_UPLOAD_TTL_SECONDS * 1000)
    for (const organizationId of await data.organizationsWithPendingFiles(before)) {
      const scope = data.asSystem(organizationId)
      const expired = await scope.files.expirePending(before)
      await Promise.all(expired.map((file) => removeFileObject(scope, file, log)))
    }
  },
})
