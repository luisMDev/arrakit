import { pub } from '../orpc/base'

export const healthRouter = {
  get: pub.health.get.handler(({ context }) => context.data.health()),
}
