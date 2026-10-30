import { mcpResourceURL, oauthIssuer } from '@arrakit/auth'
import { APP_NAME } from '@arrakit/emails'
import type { McpHttpHandler } from '@modelcontextprotocol/server'
import { Hono } from 'hono'

import type { AppDeps } from '../deps'
import { bearerToken } from '../mcp/bearer-token'
import { mcpHandler } from '../mcp/handler'
import { verifyAccessToken } from '../mcp/verify-access-token'

const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource/api/mcp'

const openHandlers = new Set<McpHttpHandler>()

export async function closeMcpHandlers(): Promise<void> {
  const handlers = [...openHandlers]
  openHandlers.clear()
  await Promise.allSettled(handlers.map((handler) => handler.close()))
}

export function mcpRoutes(deps: AppDeps) {
  const { baseURL } = deps.authConfig
  const resource = mcpResourceURL(baseURL)
  const metadataURL = new URL(PROTECTED_RESOURCE_PATH, baseURL).toString()
  const handler = mcpHandler(deps.data, deps.log.child({ component: 'mcp' }))
  openHandlers.add(handler)

  return new Hono()
    .get(PROTECTED_RESOURCE_PATH, (c) =>
      c.json({
        resource,
        authorization_servers: [oauthIssuer(baseURL)],
        bearer_methods_supported: ['header'],
        resource_name: APP_NAME,
      }),
    )
    .all('/api/mcp', async (c) => {
      const authorization = c.req.header('authorization')
      const caller = await verifyAccessToken(deps, authorization)
      if (!caller) {
        const refused = bearerToken(authorization) ? ', error="invalid_token"' : ''
        return c.json({ error: 'invalid_token' }, 401, {
          'www-authenticate': `Bearer resource_metadata="${metadataURL}"${refused}`,
        })
      }
      return handler.fetch(c.req.raw, {
        authInfo: {
          token: bearerToken(authorization) ?? '',
          clientId: caller.clientId,
          scopes: caller.scopes,
          resource: new URL(resource),
          extra: {
            organizationId: caller.organizationId,
            userId: caller.userId,
            role: caller.role,
            organizationSlug: caller.organizationSlug,
          },
        },
      })
    })
}
