import type { Workspace } from '@arrakit/contract'
import type { WorkspaceRow } from '@arrakit/db'
import { ORPCError } from '@orpc/server'

import { dayOf } from '../day'
import { member } from '../orpc/base'

export const workspaceView = (row: WorkspaceRow): Workspace => ({
  id: row.id,
  name: row.name,
  description: row.description,
  createdOn: dayOf(row.createdAt),
})

export const NO_SUCH_WORKSPACE = 'No such workspace in your organization.'

const notFound = () => new ORPCError('NOT_FOUND', { message: NO_SUCH_WORKSPACE })

export const workspacesRouter = {
  list: member({ workspace: ['read'] }).workspaces.list.handler(async ({ context }) =>
    (await context.scope.workspaces.list()).map(workspaceView),
  ),
  create: member({ workspace: ['create'] }).workspaces.create.handler(async ({ context, input }) =>
    workspaceView(await context.scope.workspaces.create({ ...input, createdBy: context.user.id })),
  ),
  update: member({ workspace: ['update'] }).workspaces.update.handler(
    async ({ context, input: { id, ...input } }) => {
      const row = await context.scope.workspaces.update(id, input)
      if (!row) throw notFound()
      return workspaceView(row)
    },
  ),
  delete: member({ workspace: ['delete'] }).workspaces.delete.handler(
    async ({ context, input }) => {
      if (!(await context.scope.workspaces.remove(input.id))) throw notFound()
    },
  ),
}
