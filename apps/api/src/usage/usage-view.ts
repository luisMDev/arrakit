import type { UsageView } from '@arrakit/contract'
import type { MetricUsage, TopUp } from '@arrakit/db'
import { CURRENCY, METRIC_KEYS } from '@arrakit/plans'

import { dayOf } from '../day'

export function usageView(metrics: MetricUsage[], topUps: TopUp[]): UsageView {
  return {
    currency: CURRENCY,
    metrics: metrics.map(({ resetsOn, ...balance }) => ({ ...balance, resetsOn: dayOf(resetsOn) })),
    topUps: topUps.map((topUp) => ({
      paidOn: dayOf(topUp.at),
      cents: topUp.cents,
      amounts: METRIC_KEYS.flatMap((metric) => {
        const amount = topUp.amounts[metric]
        return amount === undefined ? [] : [{ metric, amount }]
      }),
    })),
  }
}
