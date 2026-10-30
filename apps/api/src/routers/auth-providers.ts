import { pub } from '../orpc/base'

export const authProvidersRouter = {
  get: pub.authProviders.get.handler(({ context }) => ({
    google: !!context.deps.authConfig.google,
    microsoft: !!context.deps.authConfig.microsoft,
  })),
}
