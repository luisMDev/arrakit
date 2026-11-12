import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type TestDatabase, openTestDatabase } from './test-database'

describe('the test database', () => {
  let database: TestDatabase
  const rows = async <T>(text: string) => (await database.client.query<T>(text)).rows

  beforeAll(async () => {
    database = await openTestDatabase()
  })
  afterAll(() => database.client.close())

  it('has the roles a Supabase database gives requests', async () => {
    const roles = await rows<{ rolname: string; rolbypassrls: boolean }>(
      `select rolname, rolbypassrls from pg_roles
       where rolname in ('anon', 'authenticated', 'service_role') order by rolname`,
    )
    expect(roles).toEqual([
      { rolname: 'anon', rolbypassrls: false },
      { rolname: 'authenticated', rolbypassrls: false },
      { rolname: 'service_role', rolbypassrls: true },
    ])
  })

  it('reads the claims of a request through auth.jwt(), only inside its transaction', async () => {
    const claims = { sub: 'user-1', role: 'authenticated', org_id: 'org-1' }
    const seen = await database.client.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
      return (await tx.query<{ jwt: unknown }>('select auth.jwt() as jwt')).rows[0]?.jwt
    })
    expect(seen).toEqual(claims)
    expect(await rows('select auth.jwt() as jwt')).toEqual([{ jwt: null }])
  })

  it('has every migration applied, the identity tables in their own schema', async () => {
    const tables = await rows<{ name: string }>(
      `select table_schema || '.' || table_name as name from information_schema.tables
       where table_name in ('users', 'workspaces') order by 1`,
    )
    expect(tables).toEqual([{ name: 'better_auth.users' }, { name: 'public.workspaces' }])
  })

  it('stands in for Realtime: send writes one private broadcast and sets the topic', async () => {
    const seen = await database.client.transaction(async (tx) => {
      await tx.query(
        `select realtime.send('{"taskId": "t-1"}'::jsonb, 'task.changed', 'org:1:tasks')`,
      )
      const topic = (await tx.query<{ topic: string }>('select realtime.topic() as topic')).rows
      const messages = (
        await tx.query<Record<string, unknown>>(
          'select id, topic, extension, payload, event, private from realtime.messages',
        )
      ).rows
      return { topic, messages }
    })
    expect(seen.topic).toEqual([{ topic: 'org:1:tasks' }])
    expect(seen.messages).toEqual([
      {
        id: expect.any(String),
        topic: 'org:1:tasks',
        extension: 'broadcast',
        payload: { taskId: 't-1', id: seen.messages[0]!.id },
        event: 'task.changed',
        private: true,
      },
    ])
    expect(await rows('select realtime.topic() as topic')).toEqual([{ topic: null }])
  })
})
