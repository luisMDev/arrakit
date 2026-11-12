import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { users } from './auth'
import { at, createdAt, updatedAt } from './columns'
import { organizations } from './organizations'
import { inOrganization, isSystem, tenantPolicies } from './policies'
import { workspaces } from './workspaces'

export const TASK_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const
export const ACTIVE_TASK_STATUSES = ['queued', 'running'] as const
export const FINISHED_TASK_STATUSES = ['succeeded', 'failed'] as const

/**
 * Background work people follow: one row per tracked job, which its worker moves through the
 * statuses and reports progress on. `workspace_id` null means organization-wide work;
 * `progress_total` null means the amount of work is not known.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),
    label: text('label'),
    requestedBy: text('requested_by').references(() => users.id, { onDelete: 'set null' }),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    progressDone: integer('progress_done').notNull().default(0),
    progressTotal: integer('progress_total'),
    errorCode: text('error_code'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    startedAt: at('started_at'),
    finishedAt: at('finished_at'),
  },
  (t) => [
    check('tasks_status_check', sql`${t.status} in ('queued', 'running', 'succeeded', 'failed')`),
    check('tasks_attempts_check', sql`${t.attempts} >= 0 and ${t.maxAttempts} >= 1`),
    check(
      'tasks_progress_check',
      sql`${t.progressDone} >= 0 and (${t.progressTotal} is null or ${t.progressDone} <= ${t.progressTotal})`,
    ),
    check('tasks_subject_check', sql`(${t.subjectType} is null) = (${t.subjectId} is null)`),
    index('tasks_organization_id_created_at_index').on(t.organizationId, t.createdAt, t.id),
    index('tasks_workspace_id_index').on(t.workspaceId),
    index('tasks_requested_by_index').on(t.requestedBy),
    index('tasks_active_updated_at_index')
      .on(t.updatedAt)
      .where(sql`${t.status} in ('queued', 'running')`),
    index('tasks_finished_at_index')
      .on(t.finishedAt)
      .where(sql`${t.status} in ('succeeded', 'failed')`),
    ...tenantPolicies('tasks', inOrganization(t.organizationId), {
      insert: true,
      update: isSystem,
    }),
  ],
)
