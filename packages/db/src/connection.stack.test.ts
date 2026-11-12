import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { connect } from './connection'
import { consoleLog } from './context'
import { assertMigrated } from './migrations'
import { stackEnv } from './testing'

describe('connect() through the pooler', () => {
  it('reaches a database the Supabase CLI has migrated', async () => {
    const connection = connect({ databaseUrl: stackEnv().DATABASE_URL }, consoleLog)
    await connection.db.execute(sql`select 1`)
    await expect(assertMigrated(connection.db)).resolves.toBeUndefined()
    await connection.close()
  }, 60_000)
})
