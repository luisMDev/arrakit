import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { at, createdAt } from './columns'
import { organizations } from './organizations'
import { either, inOrganization, isSystem, tenantPolicies } from './policies'

export const CREDIT_BUCKETS = ['plan', 'purchased'] as const
export type CreditBucket = (typeof CREDIT_BUCKETS)[number]
export const CREDIT_REASONS = ['plan_grant', 'purchase', 'consumption', 'adjustment'] as const
export type CreditReason = (typeof CREDIT_REASONS)[number]

export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(),
    bucket: text('bucket').$type<CreditBucket>().notNull(),
    reason: text('reason').$type<CreditReason>().notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    periodStart: at('period_start'),
    cents: integer('cents'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('credit_ledger_bucket_check', sql`${t.bucket} in ('plan', 'purchased')`),
    check(
      'credit_ledger_reason_check',
      sql`${t.reason} in ('plan_grant', 'purchase', 'consumption', 'adjustment')`,
    ),
    unique('credit_ledger_idempotency_unique').on(
      t.organizationId,
      t.metric,
      t.bucket,
      t.idempotencyKey,
    ),
    index('credit_ledger_organization_metric_idx').on(t.organizationId, t.metric),
    // A person may spend credits; only the system mints or reverses them.
    ...tenantPolicies('credit_ledger', inOrganization(t.organizationId), {
      insert: either(sql`${t.reason} = 'consumption'`, isSystem),
    }),
  ],
)

export const usageLevels = pgTable(
  'usage_levels',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(),
    value: bigint('value', { mode: 'number' }).notNull(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'usage_levels_pkey', columns: [t.organizationId, t.metric] }),
    ...tenantPolicies('usage_levels', inOrganization(t.organizationId), {
      insert: true,
      update: true,
    }),
  ],
)
