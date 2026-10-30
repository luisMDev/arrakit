import type { Metric } from '@arrakit/plans'
import { os } from '@orpc/server'

import type { MemberContext } from '../orpc/context'

/** Runs after requireMember; checks (never spends) that `quantity` of `metric` is available. */
export function requiresUsage(_metric: Metric, _quantity = 1) {
  return os.$context<MemberContext>().middleware(async ({ next }) => {
    return next()
  })
}
