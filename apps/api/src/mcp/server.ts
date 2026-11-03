import { type Permissions, allows } from '@arrakit/auth/permissions'
import { organizationSummarySchema, workspaceInputSchema, workspaceSchema } from '@arrakit/contract'
import { DomainError, type OrganizationRow, type OrganizationScope } from '@arrakit/db'
import { type CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { NOT_PERMITTED } from '../orpc/context'
import { workspaceView } from '../routers/workspaces'

const MCP_SERVER_NAME = 'arrakit'
const MCP_SERVER_VERSION = '0.1.0'

const MCP_INSTRUCTIONS =
  'This server acts as one person in one of their organizations: the person who connected it. Use whoami to read who that is and their organization. Add a tool per thing the product does; every tool reads the caller from the token, never from its arguments.'

/** Who a request acts as: the person and organization its token names, never a tool argument. */
export type ConnectorCaller = {
  userId: string
  organization: OrganizationRow
  role: string
  /** Read on first use: a custom role costs a query that whoami and tools/list never need. */
  permissions: () => Promise<Permissions>
  scope: OrganizationScope
}

const WHOAMI_OUTPUT = z.object({
  organization: organizationSummarySchema,
  role: z.string().describe("The person's role in it: owner, admin, member or a custom role"),
})

const WORKSPACES_OUTPUT = z.object({ workspaces: z.array(workspaceSchema) })

const refusal = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text }],
})

/**
 * Runs `tool` when the caller's role grants `wanted`; a refusal or a domain error (such as a
 * taken name) is answered as a tool error the model can read and act on.
 */
async function allowed(
  caller: ConnectorCaller,
  wanted: Permissions,
  tool: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  if (!allows(await caller.permissions(), wanted)) return refusal(NOT_PERMITTED)
  try {
    return await tool()
  } catch (err) {
    if (err instanceof DomainError) return refusal(err.message)
    throw err
  }
}

export function createMcpServer(caller: ConnectorCaller): McpServer {
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
        structuredContent: { organization: organizationSummarySchema.parse(organization), role },
      }
    },
  )

  server.registerTool(
    'list_workspaces',
    {
      title: 'List workspaces',
      description: "The organization's workspaces, by name.",
      outputSchema: WORKSPACES_OUTPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      allowed(caller, { workspace: ['read'] }, async () => {
        const workspaces = (await caller.scope.workspaces.list()).map(workspaceView)
        return {
          content: [
            {
              type: 'text',
              text: workspaces.map((w) => w.name).join('\n') || 'No workspaces yet.',
            },
          ],
          structuredContent: { workspaces },
        }
      }),
  )

  server.registerTool(
    'create_workspace',
    {
      title: 'Create a workspace',
      description:
        'Creates a workspace in the organization. Names are unique in it, ignoring case.',
      inputSchema: workspaceInputSchema,
      outputSchema: workspaceSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (input) =>
      allowed(caller, { workspace: ['create'] }, async () => {
        const workspace = workspaceView(
          await caller.scope.workspaces.create({ ...input, createdBy: caller.userId }),
        )
        return {
          content: [{ type: 'text', text: `Created ${workspace.name}.` }],
          structuredContent: workspace,
        }
      }),
  )

  return server
}
