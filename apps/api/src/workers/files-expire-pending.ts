import { WORKER_RETRY_POLICY, objectPathOf } from '@arrakit/db'
import { z } from 'zod'

import { UPLOAD_URL_SECONDS } from '../files/files'
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
      for (const file of await scope.files.expirePending(before)) {
        try {
          await scope.objects.remove(objectPathOf(file))
        } catch (err) {
          log.error(
            { err, organizationId, fileId: file.id },
            'expired upload object not removed; it stays in the bucket',
          )
        }
      }
    }
  },
})
