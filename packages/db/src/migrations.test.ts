import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { assertMigrated, latestMigration, versionOf } from './migrations'
import { type TestDatabase, openTestDatabase } from './test-database'

describe('the migration the code needs', () => {
  it('is the newest entry of the journal drizzle-kit keeps', () => {
    expect(latestMigration()).toMatch(/^\d{14}_\w+$/)
  })

  it('is recorded by the Supabase CLI under its timestamp', () => {
    expect(versionOf('20261112101326_init')).toBe('20261112101326')
  })
})

describe('assertMigrated', () => {
  let database: TestDatabase
  const record = (version: string) =>
    database.client.query('insert into supabase_migrations.schema_migrations values ($1)', [
      version,
    ])

  beforeAll(async () => {
    database = await openTestDatabase()
  })
  afterAll(() => database.client.close())

  it('refuses a database the Supabase CLI never migrated, saying what to run', async () => {
    await expect(assertMigrated(database.db)).rejects.toThrow(
      '[data] the database has no migrations applied: run `pnpm db:migrate`',
    )
  })

  it('refuses a database that is behind, naming the migration it lacks', async () => {
    await database.client.exec(`
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations (version text primary key);
    `)
    await record('20200101000000')
    await expect(assertMigrated(database.db)).rejects.toThrow(
      `[data] the database is missing migration ${latestMigration()}: run \`pnpm db:migrate\``,
    )
  })

  it('accepts a database that has it, newer migrations included', async () => {
    await record(versionOf(latestMigration()))
    await record('99990101000000')
    await expect(assertMigrated(database.db)).resolves.toBeUndefined()
  })
})
