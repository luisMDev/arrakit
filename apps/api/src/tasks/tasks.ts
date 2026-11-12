import { type Permissions, allows } from '@arrakit/auth/permissions'
import type { TaskPage, TaskView } from '@arrakit/contract'
import { DomainError, type ListedTask, type OrganizationScope, type TaskCursor } from '@arrakit/db'

import { NOT_PERMITTED } from '../orpc/context'

export const NO_SUCH_TASK = 'No such task in your organization.'
export const BAD_CURSOR = 'That page of tasks does not exist. Start from the first page.'

export interface TaskActor {
  userId: string
  permissions: Permissions
  scope: OrganizationScope
}

export function taskView(row: ListedTask, viewerId: string): TaskView {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    workspaceId: row.workspaceId,
    subject: row.subjectType && row.subjectId ? { type: row.subjectType, id: row.subjectId } : null,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    progress: { done: row.progressDone, total: row.progressTotal },
    errorCode: row.errorCode,
    result: row.result ?? null,
    requestedById: row.requestedBy,
    requesterName: row.requesterName,
    requestedByYou: row.requestedBy === viewerId,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }
}

export const encodeCursor = ({ createdAt, id }: TaskCursor): string =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url')

export function decodeCursor(cursor: string): TaskCursor {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|')
  const createdAt = new Date(at ?? '')
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (Number.isNaN(createdAt.getTime()) || !id || !uuid.test(id)) {
    throw new DomainError('BAD_REQUEST', BAD_CURSOR)
  }
  return { createdAt, id }
}

/**
 * Tasks as one member may see them: their own, or all with `task:read`; those of a workspace only
 * with `workspace:read`. Any other task answers NOT_FOUND.
 */
export function taskService(actor: TaskActor) {
  const { scope, permissions, userId } = actor
  const seesAll = allows(permissions, { task: ['read'] })
  const readsWorkspaces = allows(permissions, { workspace: ['read'] })

  const inWorkspaceAsked = (workspaceId: string | undefined) => {
    if (workspaceId && !readsWorkspaces) throw new DomainError('FORBIDDEN', NOT_PERMITTED)
    return workspaceId ?? (readsWorkspaces ? undefined : null)
  }
  const visible = (row: ListedTask) =>
    (seesAll || row.requestedBy === userId) && (row.workspaceId === null || readsWorkspaces)
  const view = (row: ListedTask) => taskView(row, userId)

  return {
    async list(input: {
      status: 'active' | 'finished'
      workspaceId?: string
      after?: string
      limit: number
    }): Promise<TaskPage> {
      const page = await scope.tasks.list({
        status: input.status,
        workspaceId: inWorkspaceAsked(input.workspaceId),
        requestedBy: seesAll ? undefined : userId,
        limit: input.limit,
        after: input.after === undefined ? undefined : decodeCursor(input.after),
      })
      return { tasks: page.tasks.map(view), next: page.next && encodeCursor(page.next) }
    },

    async get(id: string): Promise<TaskView> {
      const row = await scope.tasks.get(id)
      if (!row || !visible(row)) throw new DomainError('NOT_FOUND', NO_SUCH_TASK)
      return view(row)
    },
  }
}
