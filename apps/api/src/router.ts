import { pub } from './orpc/base'
import { meRouter } from './routers/account'
import { authProvidersRouter } from './routers/auth-providers'
import { billingRouter } from './routers/billing'
import { healthRouter } from './routers/health'
import { invitationsRouter } from './routers/invitations'
import { membersRouter } from './routers/members'
import { onboardingRouter } from './routers/onboarding'
import { organizationsRouter } from './routers/organizations'
import { plansRouter } from './routers/plans'
import { usageRouter } from './routers/usage'

export const router = pub.router({
  health: healthRouter,
  authProviders: authProvidersRouter,
  me: meRouter,
  organizations: { ...onboardingRouter, ...organizationsRouter },
  members: membersRouter,
  invitations: invitationsRouter,
  plans: plansRouter,
  billing: billingRouter,
  usage: usageRouter,
})

export type Router = typeof router
