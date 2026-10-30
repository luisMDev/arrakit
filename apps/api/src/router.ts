import { pub } from './orpc/base'
import { meRouter } from './routers/account'
import { authProvidersRouter } from './routers/auth-providers'
import { billingRouter } from './routers/billing'
import { onboardingRouter } from './routers/onboarding'
import { plansRouter } from './routers/plans'
import { teamsRouter } from './routers/teams'
import { usageRouter } from './routers/usage'

export const router = pub.router({
  authProviders: authProvidersRouter,
  me: meRouter,
  onboarding: onboardingRouter,
  teams: teamsRouter,
  plans: plansRouter,
  billing: billingRouter,
  usage: usageRouter,
})

export type Router = typeof router
