import { organizationNameOnSkip, organizationNameOr } from '@arrakit/address'

import { authed } from '../orpc/base'
import type { BaseContext } from '../orpc/context'

/**
 * Creates the organization through Better Auth (the person becomes its owner and it becomes the
 * session's active one); the auth hook gives it the first free slug.
 */
async function createOrganization(context: BaseContext, name: string) {
  const created = await context.deps.auth.api.createOrganization({
    headers: context.headers,
    body: { name, slug: 'pending' },
  })
  const scope = context.deps.data.forOrganization(created.id)
  const organization = (await scope.organization())!
  return { organization, scope }
}

export const onboardingRouter = {
  create: authed.onboarding.create.handler(async ({ context, input }) => {
    const { user, session } = context
    const personName = input.personName?.trim()
    if (personName) await context.deps.data.updateAccount(user.id, session.id, { name: personName })
    const name = organizationNameOr(input.name, user.email, personName || user.name)
    const { organization, scope } = await createOrganization(context, name)
    await scope.members.acceptTerms(user.id)
    return organization
  }),
  skip: authed.onboarding.skip.handler(async ({ context }) => {
    const { user } = context
    const name = organizationNameOnSkip(user.email, user.name)
    return (await createOrganization(context, name)).organization
  }),
}
