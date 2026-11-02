import { MCP_SCOPE, mcpResourceURL, oauthIssuer } from '@arrakit/auth'
import { APP_NAME } from '@arrakit/emails'
import {
  type McpHttpHandler,
  OAuthError,
  type OAuthProtectedResourceMetadata,
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  verifyBearerToken,
} from '@modelcontextprotocol/server'
import { Hono } from 'hono'

import type { AppDeps } from '../deps'
import { type ConnectorCaller, createMcpServer } from '../mcp/server'
import { accessTokenVerifier } from '../mcp/verify-access-token'
import type { Logger } from '../observability/logger'

const MCP_PATH = '/api/mcp'

/**
 * Stateless Streamable HTTP: a fresh server per request, built from the verified caller in
 * `authInfo.extra` only. GET and DELETE (2025 sessions) are answered 405 by the SDK.
 */
export function mcpHandler(log: Logger): McpHttpHandler {
  const mcpLog = log.child({ component: 'mcp' })
  return createMcpHandler(({ authInfo }) => createMcpServer(authInfo!.extra as ConnectorCaller), {
    legacy: 'stateless',
    keepAliveMs: 0,
    onerror: (err) => mcpLog.warn({ err }, 'MCP request failed'),
  })
}

export function mcpRoutes(deps: AppDeps, handler: McpHttpHandler) {
  const { baseURL } = deps.authConfig
  const resource = new URL(mcpResourceURL(baseURL))
  const metadataURL = new URL(getOAuthProtectedResourceMetadataUrl(resource))
  const metadata: OAuthProtectedResourceMetadata = {
    resource: resource.href,
    authorization_servers: [oauthIssuer(baseURL)],
    scopes_supported: [MCP_SCOPE, 'offline_access'],
    bearer_methods_supported: ['header'],
    resource_name: APP_NAME,
  }
  const bearer = {
    verifier: accessTokenVerifier(deps),
    requiredScopes: [MCP_SCOPE],
    resourceMetadataUrl: metadataURL.href,
  }

  return new Hono()
    .get(metadataURL.pathname, (c) => c.json(metadata))
    .all(MCP_PATH, async (c) => {
      let authInfo
      try {
        authInfo = await verifyBearerToken(c.req.header('authorization'), bearer)
      } catch (err) {
        if (err instanceof OAuthError) return bearerAuthChallengeResponse(err, bearer)
        throw err
      }
      return handler.fetch(c.req.raw, { authInfo })
    })
}
