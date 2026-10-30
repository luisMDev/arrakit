import type { ScopedData } from '@arrakit/db'
import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

export const MCP_SERVER_NAME = 'arrakit'
export const MCP_SERVER_VERSION = '0.1.0'

export const MCP_INSTRUCTIONS =
  'This server acts as one person in one of their organizations: the person who connected it. Use whoami to read who that is and their organization. Add a tool per thing the product does; every tool reads the caller from the token, never from its arguments.'

export type ConnectorRole = 'owner' | 'admin' | 'member'

/** Who a request acts as: the person and organization its token names, never a tool argument. */
export interface ConnectorCaller {
  userId: string
  organizationId: string
  role: ConnectorRole
  organizationSlug: string
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

/** A fresh MCP server for one request, acting as `caller`. */
export function createMcpServer(
  data: ScopedData,
  caller: Pick<ConnectorCaller, 'userId' | 'organizationId' | 'role'>,
): McpServer {
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
    async () => {
      const organization = await data.forOrganization(caller.organizationId).organization()
      if (!organization) {
        return { isError: true, content: [{ type: 'text', text: 'The organization is gone.' }] }
      }
      const output = {
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          plan: organization.plan,
        },
        role: caller.role,
      }
      return {
        content: [{ type: 'text', text: `${organization.name} (${caller.role})` }],
        structuredContent: output,
      }
    },
  )

  return server
}
