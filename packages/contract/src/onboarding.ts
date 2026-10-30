import { z } from 'zod'

import { base, organizationSummarySchema } from './common'

export const createOrganizationSchema = z.object({
  name: z.string().trim().max(200),
  personName: z.string().trim().max(200).optional(),
  termsAccepted: z.literal(true, { error: 'Accept the Terms and the Privacy Policy.' }),
})

export const onboardingContract = {
  create: base
    .route({ method: 'POST', path: '/organizations', tags: ['organizations'], successStatus: 201 })
    .input(createOrganizationSchema)
    .output(organizationSummarySchema),
  /** Any body is ignored: the name comes only from the session. */
  skip: base
    .route({
      method: 'POST',
      path: '/organizations/skip',
      tags: ['organizations'],
      successStatus: 201,
    })
    .output(organizationSummarySchema),
}
