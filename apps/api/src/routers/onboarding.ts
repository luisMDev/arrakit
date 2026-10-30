import { organizationNameOnSkip, organizationNameOr } from '@arrakit/address'
import {
  type OrganizationAdmin,
  OrganizationNameUnusableError,
  type OrganizationRow,
  PersonHasOrganizationError,
} from '@arrakit/db'
import { ORPCError } from '@orpc/server'

import { authed } from '../orpc/base'
import type { SessionContext } from '../orpc/context'

async function createFor(context: SessionContext, name: string, admin: OrganizationAdmin) {
  let organization: OrganizationRow
  try {
    organization = await context.data.createOrganization(name, admin)
  } catch (err) {
    if (err instanceof PersonHasOrganizationError)
      throw new ORPCError('CONFLICT', { message: 'You already have an organization.' })
    if (err instanceof OrganizationNameUnusableError)
      throw new ORPCError('BAD_REQUEST', { message: err.message })
    throw err
  }
  const { id, slug, plan } = organization
  return { id, name: organization.name, slug, plan }
}

export const onboardingRouter = {
  create: authed.organizations.create.handler(({ context, input }) => {
    const personName = input.personName || context.user.name
    return createFor(context, organizationNameOr(input.name, context.user.email, personName), {
      userId: context.user.id,
      personName: input.personName,
      termsAccepted: true,
    })
  }),
  skip: authed.organizations.skip.handler(({ context }) =>
    createFor(context, organizationNameOnSkip(context.user.email, context.user.name), {
      userId: context.user.id,
      termsAccepted: false,
    }),
  ),
}
