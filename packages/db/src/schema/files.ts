import { sql } from 'drizzle-orm'
import { bigint, check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { users } from './auth'
import { createdAt, updatedAt } from './columns'
import { organizations } from './organizations'
import { workspaces } from './workspaces'

export const FILE_STATUSES = ['pending', 'ready'] as const
export type FileStatus = (typeof FILE_STATUSES)[number]

/** Uploaded files; `workspace_id` null means the file belongs to the organization itself. */
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    status: text('status', { enum: FILE_STATUSES }).notNull().default('pending'),
    uploadedBy: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('files_status_check', sql`${t.status} in ('pending', 'ready')`),
    check('files_size_bytes_check', sql`${t.sizeBytes} >= 0`),
    uniqueIndex('files_scope_name_unique')
      .on(
        t.organizationId,
        sql`coalesce(${t.workspaceId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`lower(${t.name})`,
      )
      .where(sql`${t.status} = 'ready'`),
    index('files_organization_id_workspace_id_index').on(t.organizationId, t.workspaceId),
  ],
)
