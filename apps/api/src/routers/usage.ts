import { CURRENCY, METRIC_KEYS } from '@arrakit/plans'

import { dayOf } from '../day'
import { member } from '../orpc/base'

export const usageRouter = {
  get: member({ usage: ['read'] }).usage.get.handler(async ({ context }) => {
    const { usage } = context.scope
    const [metrics, topUps] = await Promise.all([usage.summary(), usage.topUps()])
    return {
      currency: CURRENCY,
      metrics: metrics.map(({ resetsOn, ...balance }) => ({
        ...balance,
        resetsOn: dayOf(resetsOn),
      })),
      topUps: topUps.map((topUp) => ({
        paidOn: dayOf(topUp.at),
        cents: topUp.cents,
        amounts: METRIC_KEYS.flatMap((metric) => {
          const amount = topUp.amounts[metric]
          return amount === undefined ? [] : [{ metric, amount }]
        }),
      })),
    }
  }),
}
