import { type Permissions, allows } from '@arrakit/auth/permissions'
import { FILE_NAME_MAX } from '@arrakit/plans'
import {
  artifactContentRequestSchema,
  artifactContentSchema,
  artifactCreateSchema,
  artifactIdSchema,
  artifactPublishSchema,
  artifactRenameSchema,
  artifactSchema,
  artifactScopeSchema,
  downloadLinkSchema,
  fileIdSchema,
  fileNameSchema,
  fileSchema,
  fileScopeSchema,
  organizationSummarySchema,
  taskSchema,
  taskScopeSchema,
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

import { artifactService } from '../artifacts/artifacts'
import { type FileActor, fileService } from '../files/files'
import type { Logger } from '../observability/logger'
import { NOT_PERMITTED } from '../orpc/context'
import { taskService } from '../tasks/tasks'
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

const TASKS_OUTPUT = z.object({ tasks: z.array(taskSchema) })

const taskListInput = taskScopeSchema.extend({
  workspaceId: taskScopeSchema.shape.workspaceId.describe(
    'A workspace id from list_workspaces; omit it for every task the person may see',
  ),
  status: z
    .enum(['active', 'finished'])
    .default('active')
    .describe('active: queued or running; finished: succeeded or failed, newest first'),
})

const taskLine = ({ kind, label, status, progress }: z.infer<typeof taskSchema>) => {
  const done = progress.total === null ? '' : ` ${progress.done}/${progress.total}`
  return `${kind}${label ? ` (${label})` : ''}: ${status}${done}`
}

const ARTIFACTS_OUTPUT = z.object({ artifacts: z.array(artifactSchema) })

const artifactScopeInput = artifactScopeSchema.extend({
  workspaceId: artifactScopeSchema.shape.workspaceId.describe(
    "A workspace id from list_workspaces; omit it for the organization's own artifacts",
  ),
})

const artifactCreateInput = artifactCreateSchema.extend({
  workspaceId: artifactScopeInput.shape.workspaceId,
  format: artifactCreateSchema.shape.format.describe(
    'html for a self-contained page (inline CSS and JS; it runs sandboxed, without network access), markdown for a document',
  ),
  content: artifactCreateSchema.shape.content.describe('The full source of the first version'),
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

  server.registerTool(
    'list_tasks',
    {
      title: 'List background tasks',
      description:
        'Background work in the organization and how far along it is: the tasks the person started, or all of them for a role that reads tasks.',
      inputSchema: taskListInput,
      outputSchema: TASKS_OUTPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ workspaceId, status }) =>
      allowed(caller, {}, async (permissions) => {
        const tasks = taskService({
          userId: caller.userId,
          permissions,
          scope: caller.scope,
          organizationId: caller.organization.id,
        })
        const page = await tasks.list({ status, workspaceId, limit: 50 })
        return {
          content: [{ type: 'text', text: page.tasks.map(taskLine).join('\n') || 'No tasks.' }],
          structuredContent: { tasks: page.tasks },
        }
      }),
  )

  /** `allowed`, handing the tool the caller's artifact service. */
  const artifactTool = (
    wanted: Permissions,
    tool: (artifacts: ReturnType<typeof artifactService>) => Promise<CallToolResult>,
  ) =>
    allowed(caller, wanted, (permissions) =>
      tool(
        artifactService({
          userId: caller.userId,
          permissions,
          plan: caller.organization.plan,
          scope: caller.scope,
        }),
      ),
    )

  const artifactLine = (a: { title: string; format: string; currentVersion: number; id: string }) =>
    `${a.title} (${a.format}, v${a.currentVersion}) ${a.id}`

  server.registerTool(
    'list_artifacts',
    {
      title: 'List artifacts',
      description:
        'The HTML and Markdown reports published to the organization, or to one workspace when workspaceId is given, most recently changed first.',
      inputSchema: artifactScopeInput,
      outputSchema: ARTIFACTS_OUTPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ workspaceId }) =>
      artifactTool({ artifact: ['read'] }, async (artifacts) => {
        const listed = await artifacts.list(workspaceId ?? null)
        return {
          content: [
            { type: 'text', text: listed.map(artifactLine).join('\n') || 'No artifacts yet.' },
          ],
          structuredContent: { artifacts: listed },
        }
      }),
  )

  server.registerTool(
    'read_artifact',
    {
      title: 'Read an artifact',
      description:
        'The source of one version of an artifact, the current one when version is omitted. Use list_artifacts for its id.',
      inputSchema: artifactContentRequestSchema,
      outputSchema: artifactContentSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id, version }) =>
      artifactTool({ artifact: ['read'] }, async (artifacts) => {
        const read = await artifacts.content(id, version)
        return { content: [{ type: 'text', text: read.content }], structuredContent: read }
      }),
  )

  server.registerTool(
    'create_artifact',
    {
      title: 'Create an artifact',
      description:
        'Publishes a report (HTML or Markdown) to the organization, or to a workspace when workspaceId is given, as version 1. The plan limits its size. To change it later use publish_artifact_version, which keeps its id.',
      inputSchema: artifactCreateInput,
      outputSchema: artifactSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ workspaceId, ...input }) =>
      artifactTool({ artifact: ['create'] }, async (artifacts) => {
        const artifact = await artifacts.create({ ...input, workspaceId: workspaceId ?? null })
        return {
          content: [{ type: 'text', text: `Created ${artifactLine(artifact)}.` }],
          structuredContent: artifact,
        }
      }),
  )

  server.registerTool(
    'publish_artifact_version',
    {
      title: 'Publish a new artifact version',
      description:
        'Replaces the content of an artifact with a new version, keeping its id, title and format; earlier versions stay readable. Use list_artifacts for its id.',
      inputSchema: artifactPublishSchema,
      outputSchema: artifactSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ id, content }) =>
      artifactTool({ artifact: ['read'] }, async (artifacts) => {
        const artifact = await artifacts.publish(id, content)
        return {
          content: [{ type: 'text', text: `Published ${artifactLine(artifact)}.` }],
          structuredContent: artifact,
        }
      }),
  )

  server.registerTool(
    'rename_artifact',
    {
      title: 'Rename an artifact',
      description: 'Changes the title of an artifact. Use list_artifacts for its id.',
      inputSchema: artifactRenameSchema,
      outputSchema: artifactSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ id, title }) =>
      artifactTool({ artifact: ['read'] }, async (artifacts) => {
        const artifact = await artifacts.rename(id, title)
        return {
          content: [{ type: 'text', text: `Renamed to ${artifact.title}.` }],
          structuredContent: artifact,
        }
      }),
  )

  server.registerTool(
    'delete_artifact',
    {
      title: 'Delete an artifact',
      description:
        'Deletes an artifact and all its versions for good. Use list_artifacts for its id.',
      inputSchema: artifactIdSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ id }) =>
      artifactTool({ artifact: ['read'] }, async (artifacts) => {
        await artifacts.remove(id)
        return { content: [{ type: 'text', text: 'Deleted the artifact and its versions.' }] }
      }),
  )

  return server
}
