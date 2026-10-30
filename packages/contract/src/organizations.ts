import { z } from 'zod'

import { base, organizationSummarySchema } from './common'

export const updateOrganizationSchema = z
  .object({ name: z.string().trim().min(1, 'Give the organization a name.').max(200).optional() })
  .refine((body) => Object.values(body).some((v) => v !== undefined), { error: 'Send a name.' })

export const organizationsContract = {
  update: base.input(updateOrganizationSchema).output(organizationSummarySchema),
  delete: base.output(z.void()),
}
