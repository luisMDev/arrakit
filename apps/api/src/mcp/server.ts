import type { OrganizationRole } from '@arrakit/address'
import type { OrganizationRow } from '@arrakit/db'
import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { organizationSummary } from '../organizations/organization-summary'

const MCP_SERVER_NAME = 'arrakit'
const MCP_SERVER_VERSION = '0.1.0'

const MCP_INSTRUCTIONS =
  'This server acts as one person in one of their organizations: the person who connected it. Use whoami to read who that is and their organization. Add a tool per thing the product does; every tool reads the caller from the token, never from its arguments.'

/** Who a request acts as: the person and organization its token names, never a tool argument. */
export interface ConnectorCaller {
  userId: string
  organization: OrganizationRow
  role: OrganizationRole
  clientId: string
  scopes: string[]
}

const WHOAMI_OUTPUT = z.object({
  organization: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    plan: z.string(),
  }),
  role: z.string().describe("The person's role in it: owner, admin or member"),
})

export function createMcpServer(caller: Pick<ConnectorCaller, 'organization' | 'role'>): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: { listChanged: false } }, instructions: MCP_INSTRUCTIONS },
  )

  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description: 'The person this connection acts as: their organization and their role in it.',
      outputSchema: WHOAMI_OUTPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => {
      const { organization, role } = caller
      return {
        content: [{ type: 'text', text: `${organization.name} (${role})` }],
        structuredContent: { organization: organizationSummary(organization), role },
      }
    },
  )

  return server
}
