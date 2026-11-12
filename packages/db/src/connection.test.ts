import { describe, expect, it, vi } from 'vitest'

import { postgresConnection } from './connection'
import { consoleLog } from './context'

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
