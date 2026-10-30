import { randomUUID } from 'node:crypto'

import type { Plan } from '@arrakit/plans'
import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'

import { users } from './auth'
import { at, createdAt } from './columns'

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique('organizations_slug_unique'),
    logo: text('logo'),
    metadata: text('metadata'),
    plan: text('plan').$type<Plan>().notNull().default('free'),
    stripeCustomerId: text('stripe_customer_id').unique('organizations_stripe_customer_id_unique'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    usageAnchor: at('usage_anchor'),
    createdAt: createdAt(),
  },
  (t) => [check('organizations_plan_check', sql`${t.plan} in ('free', 'pro', 'team', 'internal')`)],
)

export const members = pgTable(
  'members',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    termsAcceptedAt: at('terms_accepted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('members_organization_id_user_id_unique').on(t.organizationId, t.userId),
    index('members_user_id_idx').on(t.userId),
  ],
)

export const invitations = pgTable(
  'invitations',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    teamId: text('team_id'),
    emailSent: boolean('email_sent').notNull().default(false),
    expiresAt: at('expires_at').notNull(),
    createdAt: createdAt(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('invitations_organization_id_idx').on(t.organizationId),
    index('invitations_email_idx').on(t.email),
  ],
)

export const teams = pgTable(
  'teams',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    name: text('name').notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    memberCount: integer('member_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: at('updated_at'),
  },
  (t) => [index('teams_organization_id_idx').on(t.organizationId)],
)

/** Reached through teams.organization_id (a tenancy exception). */
export const teamMembers = pgTable(
  'team_members',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    membershipKey: text('membership_key').unique('team_members_membership_key_unique'),
    createdAt: at('created_at'),
  },
  (t) => [
    index('team_members_team_id_idx').on(t.teamId),
    index('team_members_user_id_idx').on(t.userId),
  ],
)

/** Custom roles: `permission` is the JSON of the role's statements. */
export const organizationRoles = pgTable(
  'organization_roles',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    permission: text('permission').notNull(),
    createdAt: createdAt(),
    updatedAt: at('updated_at'),
  },
  (t) => [unique('organization_roles_organization_id_role_unique').on(t.organizationId, t.role)],
)
