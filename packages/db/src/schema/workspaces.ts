import { sql } from 'drizzle-orm'
import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { users } from './auth'
import { createdAt, updatedAt } from './columns'
import { organizations } from './organizations'

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('workspaces_organization_id_name_unique').on(
      t.organizationId,
      sql`lower(${t.name})`,
    ),
  ],
)
