import { organizationNameOnSkip, organizationNameOr } from '@arrakit/address'

import { authed } from '../orpc/base'
import { organizationSummary } from '../organizations/organization-summary'

export const onboardingRouter = {
  create: authed.organizations.create.handler(async ({ context, input }) => {
    const { user } = context
    const name = organizationNameOr(input.name, user.email, input.personName || user.name)
    return organizationSummary(
      await context.deps.data.createOrganization(name, {
        userId: user.id,
        personName: input.personName,
        termsAccepted: true,
      }),
    )
  }),
  skip: authed.organizations.skip.handler(async ({ context }) => {
    const { user } = context
    return organizationSummary(
      await context.deps.data.createOrganization(organizationNameOnSkip(user.email, user.name), {
        userId: user.id,
        termsAccepted: false,
      }),
    )
  }),
}
