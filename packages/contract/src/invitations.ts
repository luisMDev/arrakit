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
  list: base
    .route({ method: 'GET', path: '/invitations', tags: ['invitations'] })
    .output(z.array(invitationViewSchema)),
  invite: base
    .route({ method: 'POST', path: '/invitations', tags: ['invitations'], successStatus: 201 })
    .input(z.object({ email: z.string().max(320), role: assignableRoleSchema }))
    .output(invitationViewSchema),
  resend: base
    .route({ method: 'POST', path: '/invitations/{id}/resend', tags: ['invitations'] })
    .input(byId)
    .output(invitationViewSchema),
  cancel: base
    .route({ method: 'DELETE', path: '/invitations/{id}', tags: ['invitations'] })
    .input(byId)
    .output(z.void()),
  accept: base
    .route({ method: 'POST', path: '/invitations/{id}/accept', tags: ['invitations'] })
    .input(byId)
    .output(z.object({ organization: organizationSummarySchema, role: roleSchema })),
}
