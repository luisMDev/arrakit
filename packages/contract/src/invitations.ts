import { z } from 'zod'

import {
  assignableRoleSchema,
  base,
  daySchema,
  organizationSummarySchema,
  roleSchema,
} from './common'

export const invitationViewSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: assignableRoleSchema,
  invitedOn: daySchema,
  expiresAt: z.string(),
  emailSent: z.boolean(),
})
export type InvitationView = z.infer<typeof invitationViewSchema>

const byId = z.object({ id: z.string() })

export const invitationsContract = {
  list: base.output(z.array(invitationViewSchema)),
  invite: base
    .input(z.object({ email: z.string().max(320), role: assignableRoleSchema }))
    .output(invitationViewSchema),
  resend: base.input(byId).output(invitationViewSchema),
  cancel: base.input(byId).output(z.void()),
  accept: base
    .input(byId)
    .output(z.object({ organization: organizationSummarySchema, role: roleSchema })),
}
