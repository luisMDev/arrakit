import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'
import { Hono } from 'hono'

import type { AppDeps } from '../deps'

export function authRoutes(deps: AppDeps) {
  const metadata = oauthProviderAuthServerMetadata(deps.auth)
  return new Hono()
    .on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw))
    .get('/.well-known/oauth-authorization-server/api/auth', (c) => metadata(c.req.raw))
}
