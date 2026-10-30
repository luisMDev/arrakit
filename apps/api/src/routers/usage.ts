import { member } from '../orpc/base'
import { usageView } from '../usage/usage-view'

export const usageRouter = {
  get: member('member').usage.get.handler(async ({ context }) => {
    const { usage } = context.scope
    const [metrics, topUps] = await Promise.all([usage.summary(), usage.topUps()])
    return usageView(metrics, topUps)
  }),
}
