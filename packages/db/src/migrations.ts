import { sql } from 'drizzle-orm'

import journal from '../../../supabase/migrations/meta/_journal.json' with { type: 'json' }
import type { Database } from './connection'

const FIX = 'run `pnpm db:migrate`'

/** The newest migration this code was written against, e.g. `20261112101326_init`. */
export function latestMigration(): string {
  const newest = journal.entries.at(-1)
  if (!newest) throw new Error('[data] supabase/migrations has no migration')
  return newest.tag
}

/** The Supabase CLI records a migration under the timestamp its file name starts with. */
export const versionOf = (tag: string) => tag.slice(0, tag.indexOf('_'))

async function first<T>(db: Database, query: ReturnType<typeof sql>): Promise<T | undefined> {
  const result = (await db.execute(query)) as unknown as { rows: T[] }
  return result.rows[0]
}

/**
 * Migrations are applied by the Supabase CLI, not on boot. Rejects, saying what to run, when the
 * database does not have the newest one this code needs.
 */
export async function assertMigrated(db: Database, tag = latestMigration()): Promise<void> {
  const history = await first<{ tracked: boolean }>(
    db,
    sql`select to_regclass('supabase_migrations.schema_migrations') is not null as tracked`,
  )
  if (!history?.tracked) {
    throw new Error(`[data] the database has no migrations applied: ${FIX}`)
  }
  const migration = await first<{ applied: boolean }>(
    db,
    sql`select exists (
      select 1 from supabase_migrations.schema_migrations where version = ${versionOf(tag)}
    ) as applied`,
  )
  if (!migration?.applied) {
    throw new Error(`[data] the database is missing migration ${tag}: ${FIX}`)
  }
}
