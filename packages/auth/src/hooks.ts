import { APIError, createAuthMiddleware } from 'better-auth/api'

import type { AuthConfig } from './config'

export function beforeHook(_config: AuthConfig) {
  return createAuthMiddleware(async (ctx) => {
    // Every organization plugin route is closed over HTTP: organizations, members and invitations
    // go through our own oRPC procedures.
    if (ctx.path.startsWith('/organization/')) throw new APIError('NOT_FOUND')
  })
}
