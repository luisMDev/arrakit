import { soldOffers } from '@arrakit/plans'

import { member, pub } from './orpc/base'
import { meRouter } from './routers/account'
import { billingRouter } from './routers/billing'
import { onboardingRouter } from './routers/onboarding'
import { usageRouter } from './routers/usage'

export const router = pub.router({
  authProviders: {
    get: pub.authProviders.get.handler(({ context }) => ({
      google: !!context.deps.authConfig.google,
      microsoft: !!context.deps.authConfig.microsoft,
    })),
  },
  me: meRouter,
  onboarding: onboardingRouter,
  teams: {
    members: member().teams.members.handler(({ context, input }) =>
      context.scope.teamMembers(input.teamId),
    ),
  },
  plans: { list: pub.plans.list.handler(() => soldOffers()) },
  billing: billingRouter,
  usage: usageRouter,
})
