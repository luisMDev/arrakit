import { isOrganizationRole } from '@arrakit/address'
import type { ScopedData } from '@arrakit/db'
import { type McpHttpHandler, createMcpHandler } from '@modelcontextprotocol/server'

import type { Logger } from '../observability/logger'
import { createMcpServer } from './server'

/**
 * Stateless Streamable HTTP: a fresh server per request, built from the verified caller in
 * `authInfo.extra` only. GET and DELETE (2025 sessions) are answered 405 by the SDK.
 */
export function mcpHandler(data: ScopedData, log: Logger): McpHttpHandler {
  return createMcpHandler(
    ({ authInfo }) => {
      const { userId, organizationId, role } = authInfo?.extra ?? {}
      if (
        typeof userId !== 'string' ||
        typeof organizationId !== 'string' ||
        !isOrganizationRole(role)
      ) {
        throw new Error('[mcp] a request without a verified person')
      }
      return createMcpServer(data, { userId, organizationId, role })
    },
    {
      legacy: 'stateless',
      keepAliveMs: 0,
      onerror: (err) => log.warn({ err }, 'MCP request failed'),
    },
  )
}
