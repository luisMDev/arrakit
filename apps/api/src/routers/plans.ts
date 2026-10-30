import { notImplemented, pub } from '../orpc/base'

export const plansRouter = {
  list: pub.plans.list.handler(() => notImplemented('plans.list')),
}
