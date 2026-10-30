import { member } from '../orpc/base'
import { usageView } from '../usage/usage-view'

export const usageRouter = {
  get: member('member').usage.get.handler(async ({ context }) => {
    const usage = context.scope.usage
    const metrics = await usage.summary()
    return usageView(metrics, await usage.topUps())
  }),
}
