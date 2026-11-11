import { soldOffers } from '@arrakit/plans'

import { member, pub } from './orpc/base'
import { meRouter } from './routers/account'
import { billingRouter } from './routers/billing'
import { filesRouter } from './routers/files'
import { tasksRouter } from './routers/tasks'
import { usageRouter } from './routers/usage'
import { workspacesRouter } from './routers/workspaces'

export const router = pub.router({
  authProviders: {
    get: pub.authProviders.get.handler(({ context }) => ({
      google: !!context.deps.authConfig.google,
      microsoft: !!context.deps.authConfig.microsoft,
    })),
  },
  me: meRouter,
  teams: {
    members: member().teams.members.handler(({ context, input }) =>
      context.scope.teamMembers(input.teamId),
    ),
  },
  plans: { list: pub.plans.list.handler(() => soldOffers()) },
  billing: billingRouter,
  usage: usageRouter,
  workspaces: workspacesRouter,
  files: filesRouter,
  tasks: tasksRouter,
})
