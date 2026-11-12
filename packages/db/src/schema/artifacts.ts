import { ARTIFACT_FORMATS } from '@arrakit/plans'
import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { users } from './auth'
import { createdAt, updatedAt } from './columns'
import { organizations } from './organizations'
import { either, holds, inOrganization, isActor, tenantPolicies } from './policies'
import { workspaces } from './workspaces'

/**
 * Reports people and agents publish (HTML or Markdown); each publication is a new version.
 * `workspace_id` null means the artifact belongs to the organization itself.
 */
export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    format: text('format', { enum: ARTIFACT_FORMATS }).notNull(),
    currentVersion: integer('current_version').notNull().default(1),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('artifacts_format_check', sql`${t.format} in ('html', 'markdown')`),
    check('artifacts_current_version_check', sql`${t.currentVersion} >= 1`),
    index('artifacts_organization_id_workspace_id_index').on(t.organizationId, t.workspaceId),
    ...tenantPolicies('artifacts', inOrganization(t.organizationId), {
      insert: holds('artifact:create'),
      update: either(isActor(t.createdBy), holds('artifact:update')),
      delete: either(isActor(t.createdBy), holds('artifact:delete')),
    }),
  ],
)

export const artifactVersions = pgTable(
  'artifact_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    content: text('content').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    publishedBy: text('published_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('artifact_versions_number_check', sql`${t.number} >= 1`),
    check('artifact_versions_size_bytes_check', sql`${t.sizeBytes} >= 0`),
    uniqueIndex('artifact_versions_artifact_id_number_unique').on(t.artifactId, t.number),
    // A version may be added to an artifact the caller may update.
    ...tenantPolicies('artifact_versions', inOrganization(t.organizationId), {
      insert: sql`exists (select 1 from public.artifacts a where a.id = ${t.artifactId} and (a.created_by = (select app.user_id()) or ${holds('artifact:update')}))`,
    }),
  ],
)
