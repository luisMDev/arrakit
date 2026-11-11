import { type Permissions, allows } from '@arrakit/auth/permissions'
import type { TaskChange, TaskPage, TaskView } from '@arrakit/contract'
import { DomainError, type ListedTask, type OrganizationScope, type TaskCursor } from '@arrakit/db'

import { NOT_PERMITTED } from '../orpc/context'
import type { TaskWatchHub } from './watch'

export const NO_SUCH_TASK = 'No such task in your organization.'
export const BAD_CURSOR = 'That page of tasks does not exist. Start from the first page.'

/** How long one watch stream lasts: the client then opens another, checked again. */
export const WATCH_LIFETIME_MS = 10 * 60_000

export interface TaskActor {
  userId: string
  permissions: Permissions
  scope: OrganizationScope
  organizationId: string
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

/** Waits for the next change, the end of the stream, or `signal`. */
function changeQueue(signal: AbortSignal | undefined) {
  const pending: TaskChange[] = []
  let wake: (() => void) | undefined
  let ended = false
  const end = () => {
    ended = true
    wake?.()
  }
  signal?.addEventListener('abort', end, { once: true })
  const lifetime = setTimeout(end, WATCH_LIFETIME_MS)
  return {
    push(change: TaskChange) {
      if (change.type === 'resync') pending.splice(0)
      pending.push(change)
      wake?.()
    },
    end,
    async next(): Promise<TaskChange | undefined> {
      while (pending.length === 0 && !ended && !signal?.aborted) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        wake = undefined
      }
      return ended || signal?.aborted ? undefined : pending.shift()
    },
    close() {
      clearTimeout(lifetime)
      signal?.removeEventListener('abort', end)
    },
  }
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
  const visible = (row: ListedTask, workspaceId?: string) =>
    (seesAll || row.requestedBy === userId) &&
    (row.workspaceId === null || readsWorkspaces) &&
    (workspaceId === undefined || row.workspaceId === workspaceId)
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

    /**
     * A resync once listening, then each change to a task `list` would answer as it commits,
     * until `signal` aborts, the server stops or WATCH_LIFETIME_MS passes.
     */
    async *watch(
      input: { workspaceId?: string },
      watches: TaskWatchHub,
      signal?: AbortSignal,
    ): AsyncGenerator<TaskChange> {
      inWorkspaceAsked(input.workspaceId)
      const queue = changeQueue(signal)
      let stop = () => {}
      try {
        stop = await watches.watch(actor.organizationId, {
          task: (row) => {
            if (visible(row, input.workspaceId)) queue.push({ type: 'task', task: view(row) })
          },
          resync: () => queue.push({ type: 'resync' }),
          end: queue.end,
        })
        queue.push({ type: 'resync' })
        for (let change = await queue.next(); change; change = await queue.next()) yield change
      } finally {
        stop()
        queue.close()
      }
    },
  }
}
