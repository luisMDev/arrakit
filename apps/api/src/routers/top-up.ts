import { member, notImplemented } from '../orpc/base'

export const topUpRouter = {
  topUp: member('admin').billing.topUp.handler(() => notImplemented('billing.topUp')),
}
