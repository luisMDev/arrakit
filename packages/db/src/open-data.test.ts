import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest'

import { connect } from './connection'
import { consoleLog } from './log'
import type { ScopedData } from './open-data'
import { organizations } from './schema/index'
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
