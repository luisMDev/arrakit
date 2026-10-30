import { soldOffers } from '@arrakit/plans'

import { pub } from '../orpc/base'

export const plansRouter = {
  list: pub.plans.list.handler(() => soldOffers()),
}
