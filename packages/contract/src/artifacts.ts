import { ARTIFACT_FORMATS, ARTIFACT_TITLE_MAX } from '@arrakit/plans'
import { z } from 'zod'

import { base, daySchema } from './common'

export const artifactFormatSchema = z.enum(ARTIFACT_FORMATS)

/** Without `workspaceId` the scope is the organization itself. */
export const artifactScopeSchema = z.object({ workspaceId: z.uuid().optional() })

export const artifactTitleSchema = z.string().trim().min(1).max(ARTIFACT_TITLE_MAX)
export const artifactContentInputSchema = z.string()
export const artifactIdSchema = z.object({ id: z.uuid() })

export const artifactSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid().nullable(),
  title: z.string(),
  format: artifactFormatSchema,
  currentVersion: z.number().int().min(1),
  createdById: z.string().nullable(),
  creatorName: z.string().nullable(),
  /** The creator may always publish, rename and delete their own artifact. */
  createdByYou: z.boolean(),
  createdOn: daySchema,
  updatedAt: z.iso.datetime(),
})
export type Artifact = z.infer<typeof artifactSchema>

export const artifactVersionSchema = z.object({
  number: z.number().int().min(1),
  sizeBytes: z.number().int(),
  publishedById: z.string().nullable(),
  publisherName: z.string().nullable(),
  publishedAt: z.iso.datetime(),
})
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>

export const artifactContentSchema = z.object({
  artifactId: z.uuid(),
  version: z.number().int().min(1),
  format: artifactFormatSchema,
  content: z.string(),
})
export type ArtifactContent = z.infer<typeof artifactContentSchema>

export const artifactCreateSchema = artifactScopeSchema.extend({
  title: artifactTitleSchema,
  format: artifactFormatSchema,
  content: artifactContentInputSchema,
})
export type ArtifactCreateInput = z.infer<typeof artifactCreateSchema>

export const artifactPublishSchema = artifactIdSchema.extend({
  content: artifactContentInputSchema,
})

export const artifactRenameSchema = artifactIdSchema.extend({ title: artifactTitleSchema })

/** Without `version`, the current one. */
export const artifactContentRequestSchema = artifactIdSchema.extend({
  version: z.number().int().min(1).optional(),
})

/**
 * Reports in HTML or Markdown. Publishing adds a version and keeps the id; content larger than
 * the plan's artifact policy from `@arrakit/plans` is refused with 400.
 */
export const artifactsContract = {
  list: base.input(artifactScopeSchema).output(z.array(artifactSchema)),
  get: base.input(artifactIdSchema).output(artifactSchema),
  versions: base.input(artifactIdSchema).output(z.array(artifactVersionSchema)),
  content: base.input(artifactContentRequestSchema).output(artifactContentSchema),
  create: base.input(artifactCreateSchema).output(artifactSchema),
  publish: base.input(artifactPublishSchema).output(artifactSchema),
  rename: base.input(artifactRenameSchema).output(artifactSchema),
  delete: base.input(artifactIdSchema),
}
