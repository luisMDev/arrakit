import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest'

import { connect } from './connection'
import { consoleLog } from './context'
import type { ScopedData } from './open-data'
import { organizations } from './schema/index'
import { memoryStorage } from './storage/memory'
import type { Storage } from './storage/types'
import {
  type TestData,
  insertMember,
  insertOrganization,
  insertUser,
  openTestData,
} from './testing'

describe('openTestData', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  it('applies the migrations and reports healthy', async () => {
    await expect(data.health()).resolves.toEqual({
      status: 'ok',
      postgres: 'up',
      storage: 'up',
      queue: 'up',
    })
  })

  it('reads memberships fresh and scopes organizations by a normalized id', async () => {
    const org = await insertOrganization(data, { slug: 'acme', name: 'Acme' })
    const ana = await insertUser(data, 'ana@acme.com', 'Ana')
    await insertMember(data, org.id, ana, 'owner')

    const membership = await data.memberOf(ana)
    expect(membership?.organization.slug).toBe('acme')
    expect(membership?.role).toBe('owner')

    const scope = data.forOrganization(org.id.toUpperCase())
    expect((await scope.organization())?.name).toBe('Acme')
    expect(() => data.forOrganization('nope')).toThrow('[data] not an organization id')

    await data.db.delete(organizations).where(eq(organizations.id, org.id))
    expect(await data.memberOf(ana)).toBeNull()
  })

  it('migrating twice is a no-op', async () => {
    const connection = await connect({}, consoleLog)
    await connection.migrate()
    await connection.migrate()
    await connection.close()
  })
})

describe('ScopedData, the type app code is given', () => {
  it('has no raw database or bucket handle, only forOrganization()', () => {
    expectTypeOf<ScopedData>().not.toHaveProperty('db')
    expectTypeOf<ScopedData>().not.toHaveProperty('storage')
    expectTypeOf<ScopedData>().toHaveProperty('forOrganization')
  })
})

const quietly = () => vi.spyOn(console, 'error').mockImplementation(() => {})

describe('health', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is ok with every probe up', async () => {
    const data = await openTestData()
    expect(await data.health()).toEqual({
      status: 'ok',
      postgres: 'up',
      storage: 'up',
      queue: 'up',
    })
    await data.close()
  })

  it('reports storage down when the bucket probe fails, and logs it', async () => {
    const log = { error: vi.fn() }
    const storage: Storage = {
      ...memoryStorage(),
      probe: async () => {
        throw new Error('NoSuchBucket')
      },
    }
    const data = await openTestData({ storage, log })
    expect(await data.health()).toEqual({
      status: 'error',
      postgres: 'up',
      storage: 'down',
      queue: 'up',
    })
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: 'NoSuchBucket' }), probe: 'storage' },
      'health probe down',
    )
    await data.close()
  })

  it('reports the queue down once the data layer is closed', async () => {
    quietly()
    const data = await openTestData()
    await data.close()
    await data.close()
    const report = await data.health()
    expect(report.queue).toBe('down')
    expect(report.status).toBe('error')
  })

  it('gives up on a hanging probe after about three seconds', async () => {
    quietly()
    const storage: Storage = {
      ...memoryStorage(),
      probe: () => new Promise<void>(() => {}),
    }
    const data = await openTestData({ storage })
    const started = Date.now()
    const report = await data.health()
    const took = Date.now() - started
    expect(report).toMatchObject({ status: 'error', storage: 'down', postgres: 'up', queue: 'up' })
    expect(took).toBeGreaterThanOrEqual(2900)
    expect(took).toBeLessThan(4500)
    await data.close()
  }, 10_000)
})
