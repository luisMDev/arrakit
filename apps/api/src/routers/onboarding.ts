import { authed, notImplemented } from '../orpc/base'

export const onboardingRouter = {
  create: authed.organizations.create.handler(() => notImplemented('organizations.create')),
  skip: authed.organizations.skip.handler(() => notImplemented('organizations.skip')),
}
