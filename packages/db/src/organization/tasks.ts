import { type SQL, and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'

import { type Database, transaction } from '../connection'
import type { DataContext } from '../context'
import { DomainError } from '../errors'
import type { OrganizationId } from '../organization-id'
import {
  ACTIVE_TASK_STATUSES,
  FINISHED_TASK_STATUSES,
  tasks,
  users,
  workspaces,
} from '../schema/index'
import { TASK_EVENTS, type TaskEvent, type TaskEventPayloads } from '../tasks/events'
import { TASK_CHANNEL, type TaskNotice } from '../tasks/feed'
import { NO_SUCH_WORKSPACE } from './files'

export type TaskRow = typeof tasks.$inferSelect
export type TaskStatus = TaskRow['status']

export interface ListedTask extends TaskRow {
  requesterName: string | null
}

export interface NewTask {
  /** The queue whose worker runs the task. */
  queue: string
  kind: string
  workspaceId: string | null
  subject?: { type: string; id: string }
  /** User data shown with the task, such as a file name; never UI copy. */
  label?: string
  requestedBy: string | null
  maxAttempts: number
  input: object
}

/** The payload queued for a task's worker. */
export interface TaskJob {
  taskId: string
  organizationId: string
  input: object
}

/** Where a page of tasks ends: the next page starts after it. */
export interface TaskCursor {
  createdAt: Date
  id: string
}

export interface TaskListOptions {
  status: 'active' | 'finished'
  /** A workspace's tasks; null for organization-wide ones only; absent for all. */
  workspaceId?: string | null
  requestedBy?: string
  limit: number
  after?: TaskCursor
}

export interface TaskPage {
  tasks: ListedTask[]
  next: TaskCursor | null
}

const count = (n: number) => Math.max(0, Math.trunc(n))

export function tasksScope(ctx: DataContext, organizationId: OrganizationId) {
  const { db } = ctx
  const inOrganization = eq(tasks.organizationId, organizationId)
  const byId = (id: string) => and(inOrganization, eq(tasks.id, id))
  const inStatus = (statuses: readonly TaskStatus[]) => inArray(tasks.status, [...statuses])

  const listed = (where: SQL | undefined) =>
    db
      .select({ task: tasks, requesterName: users.name })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.requestedBy))
      .where(where)
      .$dynamic()
  const withRequesterName = ({
    task,
    requesterName,
  }: {
    task: TaskRow
    requesterName: string | null
  }): ListedTask => ({ ...task, requesterName })

  function eventOf(task: TaskRow): TaskEvent {
    return {
      organizationId,
      workspaceId: task.workspaceId,
      taskId: task.id,
      kind: task.kind,
      subjectType: task.subjectType,
      subjectId: task.subjectId,
      requestedBy: task.requestedBy,
      occurredAt: ctx.now().toISOString(),
    }
  }

  const publish = <E extends keyof TaskEventPayloads>(
    tx: Database,
    event: E,
    payload: TaskEventPayloads[E],
  ) => ctx.jobs.publish(event, payload, { tx })

  /** Tells the task feed, once `tx` commits, that the task changed. */
  async function notify(tx: Database, taskId: string) {
    const notice: TaskNotice = { organizationId, taskId }
    await tx.execute(sql`select pg_notify(${TASK_CHANNEL}, ${JSON.stringify(notice)})`)
  }

  /**
   * Moves a task in one of `from`, notifying the feed, and answers it as it is now; undefined when
   * it was in none.
   */
  async function move(
    tx: Database,
    id: string,
    from: readonly TaskStatus[],
    values: PgUpdateSetSource<typeof tasks>,
  ): Promise<TaskRow | undefined> {
    const [row] = await tx
      .update(tasks)
      .set({ ...values, updatedAt: ctx.now() })
      .where(and(byId(id), inStatus(from)))
      .returning()
    if (row) await notify(tx, id)
    return row
  }

  async function assertWorkspace(tx: Database, workspaceId: string | null) {
    if (!workspaceId) return
    const [found] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.organizationId, organizationId), eq(workspaces.id, workspaceId)))
    if (!found) throw new DomainError('NOT_FOUND', NO_SUCH_WORKSPACE)
  }

  return {
    /**
     * Creates a queued task and queues its job in one transaction: neither exists unless both do.
     * NOT_FOUND for a workspace of another organization.
     */
    start: (task: NewTask): Promise<TaskRow> =>
      transaction(db, async (tx) => {
        await assertWorkspace(tx, task.workspaceId)
        const now = ctx.now()
        const [row] = await tx
          .insert(tasks)
          .values({
            organizationId,
            workspaceId: task.workspaceId,
            kind: task.kind,
            subjectType: task.subject?.type ?? null,
            subjectId: task.subject?.id ?? null,
            label: task.label ?? null,
            requestedBy: task.requestedBy,
            maxAttempts: task.maxAttempts,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
        const job: TaskJob = { taskId: row!.id, organizationId, input: task.input }
        await ctx.jobs.send(task.queue, job, { tx })
        await notify(tx, row!.id)
        return row!
      }),

    /** Undefined when the organization has no such task. */
    get: async (id: string): Promise<ListedTask | undefined> => {
      const [row] = await listed(byId(id))
      return row && withRequesterName(row)
    },

    /** Newest first, `limit` at a time. */
    list: async (options: TaskListOptions): Promise<TaskPage> => {
      const statuses = options.status === 'active' ? ACTIVE_TASK_STATUSES : FINISHED_TASK_STATUSES
      const { after, workspaceId, requestedBy } = options
      const rows = await listed(
        and(
          inOrganization,
          inStatus(statuses),
          workspaceId === undefined
            ? undefined
            : workspaceId === null
              ? isNull(tasks.workspaceId)
              : eq(tasks.workspaceId, workspaceId),
          requestedBy === undefined ? undefined : eq(tasks.requestedBy, requestedBy),
          after
            ? or(
                lt(tasks.createdAt, after.createdAt),
                and(eq(tasks.createdAt, after.createdAt), lt(tasks.id, after.id)),
              )
            : undefined,
        ),
      )
        .orderBy(desc(tasks.createdAt), desc(tasks.id))
        .limit(options.limit + 1)
      const page = rows.slice(0, options.limit).map(withRequesterName)
      const last = page.at(-1)
      return {
        tasks: page,
        next:
          rows.length > options.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
      }
    },

    /**
     * Starts attempt `retryCount` (0 for the first run): queued or running (a retry after a worker
     * died) becomes running. Undefined when the task is gone or finished, so it must not run.
     */
    begin: (id: string, retryCount: number): Promise<TaskRow | undefined> =>
      move(db, id, ACTIVE_TASK_STATUSES, {
        status: 'running',
        attempts: count(retryCount) + 1,
        startedAt: sql`coalesce(${tasks.startedAt}, ${ctx.now().toISOString()}::timestamptz)`,
        errorCode: null,
      }),

    /**
     * Records how much of a running task is done, kept within `total` (the known total when
     * absent). Also its heartbeat. Undefined when the task is not running.
     */
    progress: (id: string, done: number, total?: number): Promise<TaskRow | undefined> => {
      if (total === undefined) {
        const capped = sql`least(${count(done)}::int, coalesce(${tasks.progressTotal}, ${count(done)}::int))`
        return move(db, id, ['running'], { progressDone: capped })
      }
      return move(db, id, ['running'], {
        progressDone: Math.min(count(done), count(total)),
        progressTotal: count(total),
      })
    },

    /** Running becomes succeeded, with its work all done, and task.succeeded is published. */
    succeed: (id: string, result?: Record<string, unknown>): Promise<TaskRow | undefined> =>
      transaction(db, async (tx) => {
        const row = await move(tx, id, ['running'], {
          status: 'succeeded',
          progressDone: sql`coalesce(${tasks.progressTotal}, ${tasks.progressDone})`,
          result: result ?? null,
          errorCode: null,
          finishedAt: ctx.now(),
        })
        if (row) await publish(tx, TASK_EVENTS.succeeded, eventOf(row))
        return row
      }),

    /** Running goes back to queued with why the attempt failed, waiting for the next one. */
    retrying: (id: string, errorCode: string): Promise<TaskRow | undefined> =>
      move(db, id, ['running'], { status: 'queued', errorCode }),

    /** Queued or running becomes failed, and task.failed is published. */
    fail: (id: string, errorCode: string): Promise<TaskRow | undefined> =>
      transaction(db, async (tx) => {
        const row = await move(tx, id, ACTIVE_TASK_STATUSES, {
          status: 'failed',
          errorCode,
          finishedAt: ctx.now(),
        })
        if (row) await publish(tx, TASK_EVENTS.failed, { ...eventOf(row), errorCode })
        return row
      }),
  }
}

export type OrganizationTasks = ReturnType<typeof tasksScope>
