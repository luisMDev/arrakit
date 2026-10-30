import { mcpResourceURL, oauthIssuer } from '@arrakit/auth'
import { APP_NAME } from '@arrakit/emails'
import { type McpHttpHandler, createMcpHandler } from '@modelcontextprotocol/server'
import { Hono } from 'hono'

import type { AppDeps } from '../deps'
import { type ConnectorCaller, createMcpServer } from '../mcp/server'
import { bearerToken, verifyAccessToken } from '../mcp/verify-access-token'
import type { Logger } from '../observability/logger'

const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource/api/mcp'

/**
 * Stateless Streamable HTTP: a fresh server per request, built from the verified caller in
 * `authInfo.extra` only. GET and DELETE (2025 sessions) are answered 405 by the SDK.
 */
export function mcpHandler(log: Logger): McpHttpHandler {
  const mcpLog = log.child({ component: 'mcp' })
  return createMcpHandler(
    ({ authInfo }) =>
      createMcpServer(authInfo!.extra as Pick<ConnectorCaller, 'organization' | 'role'>),
    {
      legacy: 'stateless',
      keepAliveMs: 0,
      onerror: (err) => mcpLog.warn({ err }, 'MCP request failed'),
    },
  )
}

export function mcpRoutes(deps: AppDeps, handler: McpHttpHandler) {
  const { baseURL } = deps.authConfig
  const resource = mcpResourceURL(baseURL)
  const metadataURL = new URL(PROTECTED_RESOURCE_PATH, baseURL).toString()

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
      const token = bearerToken(c.req.header('authorization'))
      const caller = token ? await verifyAccessToken(deps, token) : null
      if (!token || !caller) {
        const refused = token ? ', error="invalid_token"' : ''
        return c.json({ error: 'invalid_token' }, 401, {
          'www-authenticate': `Bearer resource_metadata="${metadataURL}"${refused}`,
        })
      }
      return handler.fetch(c.req.raw, {
        authInfo: {
          token,
          clientId: caller.clientId,
          scopes: caller.scopes,
          resource: new URL(resource),
          extra: { organization: caller.organization, role: caller.role },
        },
      })
    })
}
