import { ARTIFACT_EVENTS, type ArtifactEventPayloads } from '@arrakit/db'
import { ARTIFACT_FORMATS } from '@arrakit/plans'
import { z } from 'zod'

import { defineEventDomain } from '../events/domain'

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

export const artifactEvents = defineEventDomain<ArtifactEventPayloads>()({
  schemas: {
    [ARTIFACT_EVENTS.created]: versionPublishedSchema,
    [ARTIFACT_EVENTS.versionPublished]: versionPublishedSchema,
    [ARTIFACT_EVENTS.renamed]: artifactEventSchema.extend({ previousTitle: z.string() }),
    [ARTIFACT_EVENTS.deleted]: artifactEventSchema,
  },
  logFields: ({ organizationId, artifactId }) => ({ organizationId, artifactId }),
})
