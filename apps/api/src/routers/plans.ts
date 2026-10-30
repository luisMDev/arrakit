import { CURRENCY, PLANS, PLAN_OFFERS } from '@arrakit/plans'

import { pub } from '../orpc/base'

const soldOffers = () =>
  PLANS.filter((plan) => plan !== 'internal').map((plan) => {
    const offer = PLAN_OFFERS[plan]
    return {
      plan,
      monthly: { amount: offer.monthlyCents, currency: CURRENCY },
      yearly: { amount: offer.yearlyCents, currency: CURRENCY },
      seats: offer.seats,
    }
  })

export const plansRouter = {
  list: pub.plans.list.handler(() => soldOffers()),
}
