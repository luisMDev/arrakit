import { describe, expect, it } from 'vitest'

import { connect } from './connection'

describe('connect', () => {
  it('falls back to in-memory PGlite when no DATABASE_URL is given', async () => {
    const connection = await connect()
    try {
      expect(connection.driver).toBe('pglite')
      await expect(connection.ping()).resolves.toBeUndefined()
    } finally {
      await connection.close()
    }
  })
})
