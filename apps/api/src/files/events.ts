import { FILE_EVENTS, type FileEventName } from '@arrakit/db'
import { z } from 'zod'

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

export const FILE_EVENT_SCHEMAS = {
  [FILE_EVENTS.uploaded]: fileEventSchema,
  [FILE_EVENTS.renamed]: fileEventSchema.extend({ previousName: z.string() }),
  [FILE_EVENTS.deleted]: fileEventSchema,
} satisfies Record<FileEventName, z.ZodType<object>>
