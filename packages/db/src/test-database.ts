import { fileURLToPath } from 'node:url'

import { PGlite } from '@electric-sql/pglite'
import type { Logger } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

import type { Database } from './connection'
import * as schema from './schema/index'

const MIGRATIONS = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url))

/** What a Supabase database has before any migration of ours, as far as the migrations use it. */
const SUPABASE_PRELUDE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
  $$;
  grant usage on schema auth to anon, authenticated, service_role;

  alter default privileges in schema public
    grant truncate, references, trigger, maintain on tables to anon, authenticated, service_role;
`

export interface TestDatabase {
  client: PGlite
  db: Database
}

/** A fresh in-memory PGlite that looks like a Supabase database with every migration applied. */
export async function openTestDatabase(options: { logger?: Logger } = {}): Promise<TestDatabase> {
  const client = new PGlite()
  await client.exec(SUPABASE_PRELUDE)
  const db = drizzle({ client, schema, logger: options.logger })
  await migrate(db, { migrationsFolder: MIGRATIONS })
  return { client, db: db as unknown as Database }
}
