import { describe, expect, it, vi } from 'vitest'

import { MIGRATION_LOCK, connect, defaultMigrationsFolder, postgresConnection } from './connection'
import { consoleLog } from './log'

/**
 * The node-postgres path of connect(). Without Docker it is driven through a scripted pool (lock
 * order, release on failure); the DATABASE_URL block runs it against real Postgres. PGlite's own
 * node-postgres adapter cannot stand in: it hangs after a failed parameterized statement.
 */
type Query = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>

const scriptedPool = (onQuery: Query) => {
  const log: string[] = []
  const released: (Error | undefined)[] = []
  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      log.push(text)
      return onQuery(text, values)
    }),
    release: vi.fn((err?: Error) => void released.push(err)),
  }
  const pool = {
    on: vi.fn(),
    connect: vi.fn(async () => client),
    end: vi.fn(async () => {}),
  }
  return { pool, client, log, released }
}

const emptyMigrations = new URL('./__no_migrations__', import.meta.url).pathname

describe('postgresConnection (node-postgres pool)', () => {
  it('takes the advisory lock around the migrations and releases the client', async () => {
    const { pool, log, released } = scriptedPool(async () => ({ rows: [] }))
    const connection = postgresConnection(pool as never, emptyMigrations, consoleLog)
    expect(connection.driver).toBe('postgres')
    await connection.migrate().catch(() => {})
    expect(log[0]).toBe('select pg_advisory_lock($1)')
    expect(log.at(-1)).toBe('select pg_advisory_unlock($1)')
    expect(released).toEqual([undefined])
    expect(pool.on).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('runs the migrations on the locked client, between lock and unlock', async () => {
    const texts: string[] = []
    const { pool } = scriptedPool(async (text) => {
      texts.push(typeof text === 'string' ? text : (text as { text: string }).text)
      return { rows: [] }
    })
    await postgresConnection(pool as never, defaultMigrationsFolder(), consoleLog).migrate()
    expect(texts[0]).toBe('select pg_advisory_lock($1)')
    expect(texts.at(-1)).toBe('select pg_advisory_unlock($1)')
    const inner = texts.slice(1, -1).join('\n')
    expect(inner).toMatch(/__drizzle_migrations/)
    expect(inner).toMatch(/CREATE TABLE/i)
  })

  it('passes the lock key on lock and unlock', async () => {
    const { pool, client } = scriptedPool(async () => ({ rows: [] }))
    await postgresConnection(pool as never, emptyMigrations, consoleLog)
      .migrate()
      .catch(() => {})
    expect(client.query).toHaveBeenCalledWith('select pg_advisory_lock($1)', [MIGRATION_LOCK])
    expect(client.query).toHaveBeenCalledWith('select pg_advisory_unlock($1)', [MIGRATION_LOCK])
  })

  it('destroys the client (release with the error) when the unlock fails, so the lock dies with it', async () => {
    const broken = new Error('connection lost')
    const { pool, released } = scriptedPool(async (text) => {
      if (text.includes('unlock')) throw broken
      return { rows: [] }
    })
    await postgresConnection(pool as never, emptyMigrations, consoleLog)
      .migrate()
      .catch(() => {})
    expect(released).toEqual([broken])
  })

  it('releases the client when the lock cannot be taken', async () => {
    const { pool, released, log } = scriptedPool(async () => {
      throw new Error('down')
    })
    await expect(
      postgresConnection(pool as never, emptyMigrations, consoleLog).migrate(),
    ).rejects.toThrow('down')
    expect(log).toEqual(['select pg_advisory_lock($1)'])
    expect(released).toEqual([undefined])
  })

  it('closes the pool', async () => {
    const { pool } = scriptedPool(async () => ({ rows: [] }))
    await postgresConnection(pool as never, emptyMigrations, consoleLog).close()
    expect(pool.end).toHaveBeenCalled()
  })
})

describe.runIf(process.env.DATABASE_URL)('connect() on real Postgres (DATABASE_URL)', () => {
  it('lets two instances migrate at once, serialized by the advisory lock', async () => {
    const a = await connect({ databaseUrl: process.env.DATABASE_URL }, consoleLog)
    const b = await connect({ databaseUrl: process.env.DATABASE_URL }, consoleLog)
    await Promise.all([a.migrate(), b.migrate()])
    await a.ping()
    await b.ping()
    await Promise.all([a.close(), b.close()])
  }, 60_000)
})
