import type { Metric } from '@arrakit/plans'
import { os } from '@orpc/server'

import type { MemberContext } from '../orpc/context'
import { requireAvailable } from './usage-service'

/** Runs after requireMember; checks (never spends) that `quantity` of `metric` is available. */
export function requiresUsage(metric: Metric, quantity = 1) {
  return os.$context<MemberContext>().middleware(async ({ context, next }) => {
    if (!context.scope) {
      throw new Error('requiresUsage runs after the organization role middleware')
    }
    await requireAvailable(context.scope.usage, metric, quantity)
    return next()
  })
}
