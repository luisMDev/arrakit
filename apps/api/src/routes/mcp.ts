import { APP_NAME } from '@arrakit/emails'
import { mcpResourceURL, oauthIssuer } from '@arrakit/auth'
import { Hono } from 'hono'

import type { AppDeps } from '../deps'

export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource/api/mcp'

export function mcpRoutes(deps: AppDeps) {
  const { baseURL } = deps.authConfig
  const challenge = (refused: boolean) =>
    `Bearer resource_metadata="${new URL(PROTECTED_RESOURCE_PATH, baseURL)}"${refused ? ', error="invalid_token"' : ''}`

  return new Hono()
    .get(PROTECTED_RESOURCE_PATH, (c) =>
      c.json({
        resource: mcpResourceURL(baseURL),
        authorization_servers: [oauthIssuer(baseURL)],
        bearer_methods_supported: ['header'],
        resource_name: APP_NAME,
      }),
    )
    .on(['GET', 'POST', 'DELETE'], '/api/mcp', (c) => {
      const presented = !!c.req.header('authorization')
      return c.json({ error: 'invalid_token' }, 401, { 'www-authenticate': challenge(presented) })
    })
}
