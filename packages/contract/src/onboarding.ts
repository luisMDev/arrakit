import { z } from 'zod'

import { base, organizationSummarySchema } from './common'

export const createOrganizationSchema = z.object({
  name: z.string().trim().max(200),
  personName: z.string().trim().max(200).optional(),
  termsAccepted: z.literal(true, { error: 'Accept the Terms and the Privacy Policy.' }),
})

export const onboardingContract = {
  create: base.input(createOrganizationSchema).output(organizationSummarySchema),
  skip: base.output(organizationSummarySchema),
}
