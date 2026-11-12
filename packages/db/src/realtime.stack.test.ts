import { type SQL, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { type Database, connect } from './connection'
import { consoleLog } from './context'
import { openTestData, stackEnv } from './testing'

async function rowsOf<T = Record<string, unknown>>(db: Database, query: SQL): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows
}

describe('the Realtime stand-in against the stack', () => {
  const catalog = async (db: Database) => ({
    send: await rowsOf(
      db,
      sql`select pg_get_function_result('realtime.send(jsonb, text, text, boolean)'::regprocedure) as result`,
    ),
    topic: await rowsOf(
      db,
      sql`select pg_get_function_result('realtime.topic()'::regprocedure) as result`,
    ),
    columns: await rowsOf(
      db,
      sql`select column_name, data_type from information_schema.columns
          where table_schema = 'realtime' and table_name = 'messages'
            and column_name in ('topic', 'extension', 'payload', 'event', 'private')
          order by column_name`,
    ),
    rls: await rowsOf(
      db,
      sql`select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass`,
    ),
  })

  it('agrees with the stack on what the migrations and the data layer use', async () => {
    const stack = connect({ databaseUrl: stackEnv().DATABASE_URL }, consoleLog)
    const test = await openTestData()
    try {
      const expected = await catalog(stack.db)
      expect(expected.send).toEqual([{ result: 'void' }])
      expect(expected.topic).toEqual([{ result: 'text' }])
      expect(expected.columns).toHaveLength(5)
      expect(expected.rls).toEqual([{ relrowsecurity: true }])
      expect(await catalog(test.db)).toEqual(expected)
    } finally {
      await test.close()
      await stack.close()
    }
  }, 60_000)
})
