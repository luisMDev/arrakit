import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { accounts, invitations, sessions } from '../schema/index'
import {
  type TestData,
  insertMember,
  insertOrganization,
  insertUser,
  openTestData,
} from '../testing'

describe('account', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  const session = async (
    userId: string,
    userAgent: string | null,
    { createdAt = new Date(), expiresAt = new Date(Date.now() + 86_400_000) } = {},
  ) => {
    const id = randomUUID()
    await data.db
      .insert(sessions)
      .values({ id, userId, userAgent, token: randomUUID(), createdAt, expiresAt })
    return id
  }

  it('reads a fresh person: email sign-in, defaults, the current session first', async () => {
    const ana = await insertUser(data, 'ana@acme.com')
    const older = await session(ana, 'phone', { createdAt: new Date(Date.now() - 60_000) })
    const newer = await session(ana, 'laptop')
    await session(ana, 'gone', { expiresAt: new Date(Date.now() - 1000) })
    expect(await data.account(ana, older)).toEqual({
      user: {
        name: '',
        email: 'ana@acme.com',
        language: 'en',
        timeZone: null,
        emails: { productNews: false },
      },
      signInWith: 'email',
      sessions: [
        { id: older, userAgent: 'phone', current: true },
        { id: newer, userAgent: 'laptop', current: false },
      ],
    })
    expect(await data.account(randomUUID(), older)).toBeNull()
  })

  it('names the newest social provider the person signs in with', async () => {
    const bo = await insertUser(data, 'bo@acme.com')
    await data.db.insert(accounts).values({
      id: randomUUID(),
      accountId: 'g',
      providerId: 'google',
      userId: bo,
      createdAt: new Date(Date.now() - 60_000),
    })
    await data.db
      .insert(accounts)
      .values({ id: randomUUID(), accountId: 'm', providerId: 'microsoft', userId: bo })
    expect((await data.account(bo, 'none'))?.signInWith).toBe('microsoft')
  })

  it('refuses to clear an owner of any organization for deletion', async () => {
    const owner = await insertUser(data, 'owner@oak.vc')
    const first = (await insertOrganization(data, { slug: 'oak-first' })).id
    const second = (await insertOrganization(data, { slug: 'oak-second' })).id
    await insertMember(data, first, owner, 'admin')
    await insertMember(data, second, owner, 'owner')
    await data.db.insert(invitations).values({
      organizationId: first,
      email: 'owner@oak.vc',
      inviterId: owner,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    expect(await data.clearForAccountDeletion({ id: owner, email: 'owner@oak.vc' })).toBe('owner')
    expect(await data.memberOf(owner)).not.toBeNull()
    expect(
      await data.db.select().from(invitations).where(eq(invitations.email, 'owner@oak.vc')),
    ).toHaveLength(1)
  })

  it('clears the invitations addressed to a person, leaving the rest', async () => {
    const org = (await insertOrganization(data, { slug: 'pine' })).id
    const owner = await insertUser(data, 'owner@pine.vc')
    const ana = await insertUser(data, 'ana@pine.vc')
    await insertMember(data, org, owner, 'owner')
    await insertMember(data, org, ana, 'admin')
    const expiresAt = new Date(Date.now() + 86_400_000)
    await data.db.insert(invitations).values([
      {
        organizationId: org,
        email: 'ana@pine.vc',
        inviterId: owner,
        expiresAt,
        status: 'accepted',
      },
      { organizationId: org, email: 'kim@pine.vc', inviterId: ana, expiresAt },
      { organizationId: org, email: 'lee@pine.vc', inviterId: owner, expiresAt },
    ])
    expect(await data.clearForAccountDeletion({ id: ana, email: 'ana@pine.vc' })).toBe('cleared')
    expect(await data.clearForAccountDeletion({ id: randomUUID(), email: 'nobody@pine.vc' })).toBe(
      'cleared',
    )
    expect(await data.memberOf(ana)).toMatchObject({ role: 'admin' })
    expect(
      (await data.db.select().from(invitations).where(eq(invitations.organizationId, org)))
        .map((i) => i.email)
        .sort(),
    ).toEqual(['kim@pine.vc', 'lee@pine.vc'])
  })
})
