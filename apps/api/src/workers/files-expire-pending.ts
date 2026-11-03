import { WORKER_RETRY_POLICY } from '@arrakit/db'
import { z } from 'zod'

import { UPLOAD_URL_SECONDS, removeFileObject } from '../files/files'
import { defineJob } from './job'

/** Long enough for any upload URL to have expired. */
export const PENDING_UPLOAD_TTL_SECONDS = 4 * UPLOAD_URL_SECONDS

/** Drops uploads never completed, freeing their storage quota and removing any bytes sent. */
export const filesExpirePending = defineJob({
  name: 'files-expire-pending',
  schema: z.object({}),
  policy: WORKER_RETRY_POLICY,
  schedule: { cron: '*/15 * * * *', data: {} },
  async handler(_payload, { data, log }) {
    const before = new Date(Date.now() - PENDING_UPLOAD_TTL_SECONDS * 1000)
    for (const organizationId of await data.organizationsWithPendingFiles(before)) {
      const scope = data.forOrganization(organizationId)
      const expired = await scope.files.expirePending(before)
      await Promise.all(expired.map((file) => removeFileObject(scope, file, log)))
    }
  },
})
