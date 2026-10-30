import { isOrganizationRole } from '@arrakit/address'
import type { OrganizationRow } from '@arrakit/db'
import { type McpHttpHandler, createMcpHandler } from '@modelcontextprotocol/server'

import type { Logger } from '../observability/logger'
import { createMcpServer } from './server'

/**
 * Stateless Streamable HTTP: a fresh server per request, built from the verified caller in
 * `authInfo.extra` only. GET and DELETE (2025 sessions) are answered 405 by the SDK.
 */
export function mcpHandler(log: Logger): McpHttpHandler {
  return createMcpHandler(
    ({ authInfo }) => {
      const { organization, role } = authInfo?.extra ?? {}
      if (typeof organization !== 'object' || organization === null || !isOrganizationRole(role)) {
        throw new Error('[mcp] a request without a verified person')
      }
      return createMcpServer({ organization: organization as OrganizationRow, role })
    },
    {
      legacy: 'stateless',
      keepAliveMs: 0,
      onerror: (err) => log.warn({ err }, 'MCP request failed'),
    },
  )
}
