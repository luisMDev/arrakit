import type { UsageView } from '@arrakit/contract'
import type { MetricUsage, TopUp } from '@arrakit/db'
import { CURRENCY, METRIC_KEYS } from '@arrakit/plans'

const day = (at: Date) => at.toISOString().slice(0, 10)

export function usageView(metrics: MetricUsage[], topUps: TopUp[]): UsageView {
  return {
    currency: CURRENCY,
    metrics: metrics.map(({ resetsOn, ...balance }) => ({ ...balance, resetsOn: day(resetsOn) })),
    topUps: topUps.map((topUp) => ({
      paidOn: day(topUp.at),
      cents: topUp.cents,
      amounts: METRIC_KEYS.flatMap((metric) => {
        const amount = topUp.amounts[metric]
        return amount === undefined ? [] : [{ metric, amount }]
      }),
    })),
  }
}
