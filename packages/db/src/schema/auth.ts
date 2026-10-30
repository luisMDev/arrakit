import { sql } from 'drizzle-orm'
import { boolean, check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { at, createdAt, updatedAt } from './columns'
import { organizations } from './organizations'

export const ACCOUNT_LANGUAGES = ['en', 'es'] as const
export type AccountLanguage = (typeof ACCOUNT_LANGUAGES)[number]

export const users = pgTable(
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
  (t) => [check('users_language_check', sql`${t.language} in ('en', 'es')`)],
)

export const sessions = pgTable(
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
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
)

export const accounts = pgTable(
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

export const verifications = pgTable(
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
