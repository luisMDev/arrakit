import { ARTIFACT_EVENTS, type ArtifactEventName } from '@arrakit/db'
import { ARTIFACT_FORMATS } from '@arrakit/plans'
import { z } from 'zod'

const artifactEventSchema = z.object({
  organizationId: z.guid(),
  workspaceId: z.guid().nullable(),
  artifactId: z.guid(),
  title: z.string(),
  format: z.enum(ARTIFACT_FORMATS),
  version: z.number().int().min(1),
  createdBy: z.string().nullable(),
  occurredAt: z.iso.datetime(),
})

const versionPublishedSchema = artifactEventSchema.extend({
  sizeBytes: z.number().int(),
  publishedBy: z.string().nullable(),
})

export const ARTIFACT_EVENT_SCHEMAS = {
  [ARTIFACT_EVENTS.created]: versionPublishedSchema,
  [ARTIFACT_EVENTS.versionPublished]: versionPublishedSchema,
  [ARTIFACT_EVENTS.renamed]: artifactEventSchema.extend({ previousTitle: z.string() }),
  [ARTIFACT_EVENTS.deleted]: artifactEventSchema,
} satisfies Record<ArtifactEventName, z.ZodType<object>>
