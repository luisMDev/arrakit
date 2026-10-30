import { UsageLimitError } from '@arrakit/db'
import type { Metric } from '@arrakit/plans'
import { os } from '@orpc/server'

import type { MemberContext } from '../orpc/context'

/** Runs after requireMember; checks (never spends) that `quantity` of `metric` is available. */
export function requiresUsage(metric: Metric, quantity = 1) {
  return os.$context<MemberContext>().middleware(async ({ context, next }) => {
    const verdict = await context.scope.usage.check(metric, quantity)
    if (!verdict.allowed) throw new UsageLimitError(metric, verdict.requested, verdict.available)
    return next()
  })
}
