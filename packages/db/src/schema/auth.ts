import { type AccountLanguage } from '@arrakit/address'
import { sql } from 'drizzle-orm'
import { boolean, check, index, pgPolicy, pgSchema, text, uuid } from 'drizzle-orm/pg-core'
import { authenticatedRole } from 'drizzle-orm/supabase'

import { at, createdAt, updatedAt } from './columns'
import { organizations, teams } from './organizations'

export { ACCOUNT_LANGUAGES, type AccountLanguage } from '@arrakit/address'

/**
 * Better Auth's identity and OAuth tables: never exposed through the Data API, RLS on and no
 * policy, so only the privileged connection reaches them. `users` is the one exception: member and
 * team lists read the names of people who share the caller's organization.
 */
export const betterAuthSchema = pgSchema('better_auth')

export const users = betterAuthSchema.table(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique('users_email_unique'),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    language: text('language').$type<AccountLanguage>().notNull().default('en'),
    timeZone: text('time_zone'),
    emailProductNews: boolean('email_product_news').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('users_language_check', sql`${t.language} in ('en', 'es')`),
    pgPolicy('users_same_organization_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.id} in (select user_id from public.members where organization_id = (select app.org_id()))`,
    }),
  ],
)

export const sessions = betterAuthSchema
  .table(
    'sessions',
    {
      id: text('id').primaryKey(),
      expiresAt: at('expires_at').notNull(),
      token: text('token').notNull().unique('sessions_token_unique'),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
      ipAddress: text('ip_address'),
      userAgent: text('user_agent'),
      userId: text('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
      activeOrganizationId: uuid('active_organization_id').references(() => organizations.id, {
        onDelete: 'set null',
      }),
      activeTeamId: text('active_team_id').references(() => teams.id, { onDelete: 'set null' }),
    },
    (t) => [index('sessions_user_id_idx').on(t.userId)],
  )
  .enableRLS()

export const accounts = betterAuthSchema
  .table(
    'accounts',
    {
      id: text('id').primaryKey(),
      accountId: text('account_id').notNull(),
      providerId: text('provider_id').notNull(),
      userId: text('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
      accessToken: text('access_token'),
      refreshToken: text('refresh_token'),
      idToken: text('id_token'),
      accessTokenExpiresAt: at('access_token_expires_at'),
      refreshTokenExpiresAt: at('refresh_token_expires_at'),
      scope: text('scope'),
      password: text('password'),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [index('accounts_user_id_idx').on(t.userId)],
  )
  .enableRLS()

export const verifications = betterAuthSchema
  .table(
    'verifications',
    {
      id: text('id').primaryKey(),
      identifier: text('identifier').notNull(),
      value: text('value').notNull(),
      expiresAt: at('expires_at').notNull(),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [index('verifications_identifier_idx').on(t.identifier)],
  )
  .enableRLS()
