import { FILE_EVENTS, type FileEventPayloads } from '@arrakit/db'
import { z } from 'zod'

import { defineEventDomain } from '../events/domain'

const fileEventSchema = z.object({
  organizationId: z.guid(),
  workspaceId: z.guid().nullable(),
  fileId: z.guid(),
  name: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  uploadedBy: z.string().nullable(),
  occurredAt: z.iso.datetime(),
})

export const fileEvents = defineEventDomain<FileEventPayloads>()({
  schemas: {
    [FILE_EVENTS.uploaded]: fileEventSchema,
    [FILE_EVENTS.renamed]: fileEventSchema.extend({ previousName: z.string() }),
    [FILE_EVENTS.deleted]: fileEventSchema,
  },
  logFields: ({ organizationId, fileId }) => ({ organizationId, fileId }),
})
