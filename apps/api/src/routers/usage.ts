import { member, notImplemented } from '../orpc/base'

export const usageRouter = {
  get: member('member').usage.get.handler(() => notImplemented('usage.get')),
}
