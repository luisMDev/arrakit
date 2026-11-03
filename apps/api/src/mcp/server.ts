import { type Permissions, allows } from '@arrakit/auth/permissions'
import { FILE_NAME_MAX } from '@arrakit/plans'
import {
  downloadLinkSchema,
  fileIdSchema,
  fileNameSchema,
  fileSchema,
  fileScopeSchema,
  organizationSummarySchema,
  workspaceIdSchema,
  workspaceInputSchema,
  workspaceSchema,
  workspaceUpdateSchema,
} from '@arrakit/contract'
import {
  DomainError,
  NO_SUCH_WORKSPACE,
  type OrganizationRow,
  type OrganizationScope,
} from '@arrakit/db'
import { type CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { type FileActor, fileService } from '../files/files'
import type { Logger } from '../observability/logger'
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

const FILES_OUTPUT = z.object({ files: z.array(fileSchema) })

const fileScopeInput = fileScopeSchema.extend({
  workspaceId: fileScopeSchema.shape.workspaceId.describe(
    "A workspace id from list_workspaces; omit it for the organization's own files",
  ),
})

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

const uploadInput = fileScopeInput.extend({
  name: fileNameSchema.describe(
    `The file name with its extension, at most ${FILE_NAME_MAX} characters`,
  ),
  contentBase64: z.string().regex(BASE64).describe('The file content, base64 encoded'),
})

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
  tool: (permissions: Permissions) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const permissions = await caller.permissions()
  if (!allows(permissions, wanted)) return refusal(NOT_PERMITTED)
  try {
    return await tool(permissions)
  } catch (err) {
    if (err instanceof DomainError) return refusal(err.message)
    throw err
  }
}

export function createMcpServer(caller: ConnectorCaller, log: Logger): McpServer {
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

  server.registerTool(
    'update_workspace',
    {
      title: 'Update a workspace',
      description:
        'Renames a workspace and replaces its description. Use list_workspaces for its id.',
      inputSchema: workspaceUpdateSchema,
      outputSchema: workspaceSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ id, ...input }) =>
      allowed(caller, { workspace: ['update'] }, async () => {
        const row = await caller.scope.workspaces.update(id, input)
        if (!row) return refusal(NO_SUCH_WORKSPACE)
        const workspace = workspaceView(row)
        return {
          content: [{ type: 'text', text: `Updated ${workspace.name}.` }],
          structuredContent: workspace,
        }
      }),
  )

  server.registerTool(
    'delete_workspace',
    {
      title: 'Delete a workspace',
      description: 'Deletes a workspace for good. Use list_workspaces for its id.',
      inputSchema: workspaceIdSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ id }) =>
      allowed(caller, { workspace: ['delete'] }, async () => {
        if (!(await caller.scope.workspaces.remove(id))) return refusal(NO_SUCH_WORKSPACE)
        return { content: [{ type: 'text', text: 'Deleted the workspace and its files.' }] }
      }),
  )

  /** `allowed`, handing the tool the caller's file service. */
  const fileTool = (
    wanted: Permissions,
    tool: (files: ReturnType<typeof fileService>) => Promise<CallToolResult>,
  ) =>
    allowed(caller, wanted, (permissions) => {
      const actor: FileActor = {
        userId: caller.userId,
        permissions,
        plan: caller.organization.plan,
        scope: caller.scope,
        log,
      }
      return tool(fileService(actor))
    })

  server.registerTool(
    'list_files',
    {
      title: 'List files',
      description:
        'The files uploaded to the organization, or to one workspace when workspaceId is given, by name.',
      inputSchema: fileScopeInput,
      outputSchema: FILES_OUTPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ workspaceId }) =>
      fileTool({ file: ['read'] }, async (files) => {
        const listed = await files.list(workspaceId ?? null)
        return {
          content: [
            { type: 'text', text: listed.map((f) => f.name).join('\n') || 'No files yet.' },
          ],
          structuredContent: { files: listed },
        }
      }),
  )

  server.registerTool(
    'get_file_download_url',
    {
      title: 'Get a file download link',
      description: 'A short-lived link that downloads a file. Use list_files for its id.',
      inputSchema: fileIdSchema,
      outputSchema: downloadLinkSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id }) =>
      fileTool({ file: ['read'] }, async (files) => {
        const link = await files.downloadUrl(id)
        return { content: [{ type: 'text', text: link.url }], structuredContent: link }
      }),
  )

  server.registerTool(
    'upload_file',
    {
      title: 'Upload a file',
      description:
        "Uploads a file to the organization, or to a workspace when workspaceId is given. The plan limits its type and size, and it counts against the organization's storage.",
      inputSchema: uploadInput,
      outputSchema: fileSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ workspaceId, name, contentBase64 }) =>
      fileTool({ file: ['upload'] }, async (files) => {
        const file = await files.upload({
          workspaceId: workspaceId ?? null,
          name,
          bytes: Buffer.from(contentBase64, 'base64'),
        })
        return {
          content: [{ type: 'text', text: `Uploaded ${file.name}.` }],
          structuredContent: file,
        }
      }),
  )

  server.registerTool(
    'rename_file',
    {
      title: 'Rename a file',
      description: 'Renames a file, keeping its extension. Use list_files for its id.',
      inputSchema: fileIdSchema.extend({ name: fileNameSchema }),
      outputSchema: fileSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ id, name }) =>
      fileTool({ file: ['read'] }, async (files) => {
        const file = await files.rename(id, name)
        return {
          content: [{ type: 'text', text: `Renamed to ${file.name}.` }],
          structuredContent: file,
        }
      }),
  )

  server.registerTool(
    'delete_file',
    {
      title: 'Delete a file',
      description: 'Deletes a file for good. Use list_files for its id.',
      inputSchema: fileIdSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ id }) =>
      fileTool({ file: ['read'] }, async (files) => {
        await files.remove(id)
        return { content: [{ type: 'text', text: 'Deleted the file.' }] }
      }),
  )

  return server
}
