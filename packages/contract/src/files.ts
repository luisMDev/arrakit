import { FILE_NAME_MAX } from '@arrakit/plans'
import { z } from 'zod'

import { base, daySchema } from './common'

/** Without `workspaceId` the scope is the organization itself. */
export const fileScopeSchema = z.object({ workspaceId: z.uuid().optional() })
export type FileScope = z.infer<typeof fileScopeSchema>

export const fileNameSchema = z.string().min(1).max(FILE_NAME_MAX)
export const fileIdSchema = z.object({ id: z.uuid() })

export const fileSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid().nullable(),
  name: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  uploadedById: z.string().nullable(),
  uploaderName: z.string().nullable(),
  /** The uploader may always rename and delete their own file. */
  uploadedByYou: z.boolean(),
  uploadedOn: daySchema,
})
export type FileView = z.infer<typeof fileSchema>

export const filePolicySchema = z.object({
  maxBytes: z.number().int(),
  extensions: z.array(z.string()),
})
export type FilePolicyView = z.infer<typeof filePolicySchema>

export const uploadRequestSchema = fileScopeSchema.extend({
  name: fileNameSchema,
  sizeBytes: z.number().int().min(0),
})
export type UploadRequest = z.infer<typeof uploadRequestSchema>

const expiresAtSchema = z.iso.datetime()

export const uploadTicketSchema = z.object({
  file: fileSchema,
  /** PUT the bytes here with exactly these headers before `expiresAt`, then complete the upload. */
  upload: z.object({
    url: z.string(),
    headers: z.record(z.string(), z.string()),
    expiresAt: expiresAtSchema,
  }),
})
export type UploadTicket = z.infer<typeof uploadTicketSchema>

export const downloadLinkSchema = z.object({ url: z.string(), expiresAt: expiresAtSchema })

/**
 * Uploads go straight to storage: `requestUpload` checks the plan's file policy (400), the name
 * (409 when taken in the scope) and the storage quota (402), then `completeUpload` makes the file
 * visible once its bytes are there (400 when they are missing or differ from the request).
 */
export const filesContract = {
  policy: base.output(filePolicySchema),
  list: base.input(fileScopeSchema).output(z.array(fileSchema)),
  requestUpload: base.input(uploadRequestSchema).output(uploadTicketSchema),
  completeUpload: base.input(fileIdSchema).output(fileSchema),
  downloadUrl: base.input(fileIdSchema).output(downloadLinkSchema),
  rename: base.input(fileIdSchema.extend({ name: fileNameSchema })).output(fileSchema),
  delete: base.input(fileIdSchema),
}
