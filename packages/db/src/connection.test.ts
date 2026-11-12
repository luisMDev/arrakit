import { sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { connect, postgresConnection } from './connection'
import { consoleLog } from './context'
import { assertMigrated } from './migrations'

const config = { databaseUrl: 'postgres://app@pooler/app' }

const fakePool = () => ({ on: vi.fn(), end: vi.fn(async () => {}) })

describe('postgresConnection (node-postgres pool)', () => {
  it('logs an idle client that fails, so the process survives it', () => {
    const pool = fakePool()
    const log = { info: vi.fn(), error: vi.fn() }
    postgresConnection(pool as never, config, log)

    const [event, onError] = pool.on.mock.calls[0] as unknown as [string, (err: Error) => void]
    expect(event).toBe('error')
    const err = new Error('terminated')
    onError(err)
    expect(log.error).toHaveBeenCalledWith({ err }, 'idle Postgres client failed')
  })

  it('closes the pool', async () => {
    const pool = fakePool()
    await postgresConnection(pool as never, config, consoleLog).close()
    expect(pool.end).toHaveBeenCalled()
  })
})

describe.runIf(process.env.DATABASE_URL)('connect() on real Postgres (DATABASE_URL)', () => {
  it('reaches a database the Supabase CLI has migrated', async () => {
    const connection = connect({ databaseUrl: process.env.DATABASE_URL! }, consoleLog)
    await connection.db.execute(sql`select 1`)
    await expect(assertMigrated(connection.db)).resolves.toBeUndefined()
    await connection.close()
  }, 60_000)
})
