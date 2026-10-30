import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest'

import { connect } from './connection'
import { consoleLog } from './log'
import type { ScopedData } from './open-data'
import { organizations, users, members } from './schema/index'
import { type TestData, openTestData } from './testing'

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

  it('reads memberships fresh and scopes tenant tables', async () => {
    const [org] = await data.db
      .insert(organizations)
      .values({ name: 'Acme', slug: 'acme' })
      .returning()
    await data.db.insert(users).values({ id: 'u1', name: 'Ana', email: 'ana@acme.com' })
    await data.db.insert(members).values({ organizationId: org!.id, userId: 'u1', role: 'owner' })

    const membership = await data.memberOf('u1')
    expect(membership?.organization.slug).toBe('acme')
    expect(membership?.role).toBe('owner')
    expect(await data.organizationBySlug('acme')).toBe(org!.id)

    const scope = data.forOrganization(org!.id.toUpperCase())
    expect((await scope.organization())?.name).toBe('Acme')
    const rows = await scope.table(members).select((t, { eq }) => eq(t.userId, 'u1'))
    expect(rows).toHaveLength(1)
    expect(() => scope.table(organizations as never)).toThrow('has no organizationId column')
    await expect(scope.table(members).update({ role: 'admin' }, () => undefined)).rejects.toThrow(
      'need a where condition',
    )
    expect(() => data.forOrganization('nope')).toThrow('[data] not an organization id')

    await data.db.delete(organizations).where(eq(organizations.id, org!.id))
    expect(await data.memberOf('u1')).toBeNull()
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
