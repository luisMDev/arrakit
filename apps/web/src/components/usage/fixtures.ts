import type { UsageView } from '@arrakit/contract'
import { metricBalance, planGrant, type Plan } from '@arrakit/plans'

export function usageFixture({
  plan = 'pro',
  used = { credits: 250, storage_gb: 12 },
  purchased = { credits: 0, storage_gb: 0 },
  topUps = [],
}: {
  plan?: Plan
  used?: { credits: number; storage_gb: number }
  purchased?: { credits: number; storage_gb: number }
  topUps?: UsageView['topUps']
} = {}): UsageView {
  const grant = planGrant(plan)
  const credits = metricBalance('credits', {
    granted: grant.credits,
    planUsed: Math.min(used.credits, grant.credits),
    purchased: purchased.credits - Math.max(0, used.credits - grant.credits),
    used: used.credits,
  })
  const storage = metricBalance(
    'storage_gb',
    { granted: grant.storage_gb, purchased: purchased.storage_gb },
    used.storage_gb,
  )
  return {
    currency: 'usd',
    metrics: [
      { ...credits, resetsOn: '2026-11-04' },
      { ...storage, resetsOn: '2026-11-04' },
    ],
    topUps,
  }
}
