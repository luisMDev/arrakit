import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { sessions } from '../schema/index'
import {
  type TestData,
  insertMember,
  insertOrganization,
  insertUser,
  openTestData,
} from '../testing'

describe('membership', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  const sessionIn = async (userId: string, activeOrganizationId: string | null) => {
    const id = randomUUID()
    await data.db.insert(sessions).values({
      id,
      token: randomUUID(),
      userId,
      expiresAt: new Date(Date.now() + 86_400_000),
      activeOrganizationId,
    })
    return id
  }

  it('reads the earliest membership, one in a given organization, and the active one', async () => {
    const ana = await insertUser(data, 'ana@alder.vc')
    const first = await insertOrganization(data, { slug: 'alder' })
    const second = await insertOrganization(data, { slug: 'birch' })
    const foreign = await insertOrganization(data, { slug: 'cedar' })
    await insertMember(data, first.id, ana, 'owner')
    await insertMember(data, second.id, ana, 'finance')

    expect(await data.memberOf(ana)).toMatchObject({
      organization: { slug: 'alder' },
      role: 'owner',
    })
    expect(await data.membershipIn(ana, second.id.toUpperCase())).toMatchObject({
      organization: { slug: 'birch' },
      role: 'finance',
    })
    expect(await data.membershipIn(ana, foreign.id)).toBeNull()
    expect(await data.membershipIn(ana, 'not-a-uuid')).toBeNull()

    const active = await sessionIn(ana, second.id)
    expect((await data.activeMembership(ana, active))?.organization.slug).toBe('birch')
    const stale = await sessionIn(ana, foreign.id)
    expect((await data.activeMembership(ana, stale))?.organization.slug).toBe('alder')
    const unset = await sessionIn(ana, null)
    expect((await data.activeMembership(ana, unset))?.organization.slug).toBe('alder')
  })

  it('has no membership for someone in no organization', async () => {
    const lone = await insertUser(data, 'lone@elm.vc')
    expect(await data.memberOf(lone)).toBeNull()
    expect(await data.activeMembership(lone, await sessionIn(lone, null))).toBeNull()
  })
})
