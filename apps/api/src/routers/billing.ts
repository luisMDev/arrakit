import { member, notImplemented } from '../orpc/base'

const admin = member('admin')

export const billingRouter = {
  checkout: admin.billing.checkout.handler(() => notImplemented('billing.checkout')),
  get: admin.billing.get.handler(() => notImplemented('billing.get')),
  previewChange: admin.billing.previewChange.handler(() => notImplemented('billing.previewChange')),
  change: admin.billing.change.handler(() => notImplemented('billing.change')),
  cancel: admin.billing.cancel.handler(() => notImplemented('billing.cancel')),
  resume: admin.billing.resume.handler(() => notImplemented('billing.resume')),
  portal: admin.billing.portal.handler(() => notImplemented('billing.portal')),
}
