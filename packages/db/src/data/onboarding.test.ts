import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { OrganizationNameUnusableError, PersonHasOrganizationError } from '../errors'
import { members, organizations, users } from '../schema/index'
import { type TestData, openTestData } from '../testing'

describe('createOrganization (PGlite)', () => {
  let data: TestData
  let nextId = 0

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  async function person(name = '') {
    const id = `user-${++nextId}`
    await data.db.insert(users).values({ id, name, email: `${id}@acme.com`, emailVerified: true })
    return id
  }

  const membershipOf = async (userId: string) => {
    const [row] = await data.db.select().from(members).where(eq(members.userId, userId))
    return row
  }

  it('uses the name as the slug and makes the admin owner with the terms stamped', async () => {
    const userId = await person()
    const org = await data.createOrganization('  Alder Ventures ', {
      userId,
      personName: ' Lucía Gómez ',
      termsAccepted: true,
    })
    expect(org).toMatchObject({ name: 'Alder Ventures', slug: 'alder-ventures', plan: 'free' })
    const member = await membershipOf(userId)
    expect(member?.role).toBe('owner')
    expect(member?.termsAcceptedAt).toBeInstanceOf(Date)
    const [user] = await data.db.select().from(users).where(eq(users.id, userId))
    expect(user?.name).toBe('Lucía Gómez')
  })

  it('numbers the slug of same-named organizations', async () => {
    const slugs = []
    for (let i = 0; i < 3; i++) slugs.push((await data.createOrganization('Birch')).slug)
    expect(slugs).toEqual(['birch', 'birch-2', 'birch-3'])
  })

  it('gives concurrent same-named creates different slugs', async () => {
    const created = await Promise.all([
      data.createOrganization('Cedar', { userId: await person(), termsAccepted: true }),
      data.createOrganization('Cedar', { userId: await person(), termsAccepted: true }),
    ])
    expect(new Set(created.map((org) => org.slug)).size).toBe(2)
  })

  it('leaves the terms null on skip and keeps the name when personName is blank', async () => {
    const userId = await person('Marta Ruiz')
    await data.createOrganization('Elm', { userId, personName: '  ', termsAccepted: false })
    expect((await membershipOf(userId))?.termsAcceptedAt).toBeNull()
    const [user] = await data.db.select().from(users).where(eq(users.id, userId))
    expect(user?.name).toBe('Marta Ruiz')
  })

  it('refuses a second organization and creates nothing', async () => {
    const userId = await person()
    await data.createOrganization('Fir', { userId, termsAccepted: true })
    await expect(
      data.createOrganization('Fir Two', { userId, termsAccepted: true }),
    ).rejects.toBeInstanceOf(PersonHasOrganizationError)
    const rows = await data.db.select().from(organizations).where(eq(organizations.slug, 'fir-two'))
    expect(rows).toHaveLength(0)
    expect((await data.organizationOf(userId))?.slug).toBe('fir')
  })

  it('creates exactly one organization on a double submit', async () => {
    const userId = await person()
    const results = await Promise.allSettled([
      data.createOrganization('Hazel', { userId, termsAccepted: true }),
      data.createOrganization('Hazel', { userId, termsAccepted: true }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rows = await data.db.select().from(members).where(eq(members.userId, userId))
    expect(rows).toHaveLength(1)
  })

  it.each(['北京基金', '&.!'])('refuses the unaddressable name %j', async (name) => {
    await expect(
      data.createOrganization(name, { userId: await person(), termsAccepted: true }),
    ).rejects.toBeInstanceOf(OrganizationNameUnusableError)
  })

  it('returns no membership for a person without an organization', async () => {
    const userId = await person()
    expect(await data.memberOf(userId)).toBeNull()
    expect(await data.organizationOf(userId)).toBeNull()
  })

  it('creates a bare organization without an admin', async () => {
    const org = await data.createOrganization('Juniper')
    expect(org.slug).toBe('juniper')
    const rows = await data.db.select().from(members).where(eq(members.organizationId, org.id))
    expect(rows).toHaveLength(0)
  })
})
