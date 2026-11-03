import { z } from 'zod'

import { base, daySchema } from './common'

export const WORKSPACE_NAME_MAX = 100
export const WORKSPACE_DESCRIPTION_MAX = 500

export const workspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(WORKSPACE_NAME_MAX),
  description: z.string().trim().max(WORKSPACE_DESCRIPTION_MAX),
})
export type WorkspaceInput = z.infer<typeof workspaceInputSchema>

export const workspaceIdSchema = z.object({ id: z.uuid() })
export const workspaceUpdateSchema = workspaceIdSchema.extend(workspaceInputSchema.shape)

export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  createdOn: daySchema,
})
export type Workspace = z.infer<typeof workspaceSchema>

/** A name another workspace of the organization has, ignoring case, is refused with 409. */
export const workspacesContract = {
  list: base.output(z.array(workspaceSchema)),
  create: base.input(workspaceInputSchema).output(workspaceSchema),
  update: base.input(workspaceUpdateSchema).output(workspaceSchema),
  delete: base.input(workspaceIdSchema),
}
