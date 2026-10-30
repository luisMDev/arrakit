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

  it('writes only the given keys and never touches another person', async () => {
    const cy = await insertUser(data, 'cy@acme.com', 'Cy')
    const other = await insertUser(data, 'dee@acme.com', 'Dee')
    const unchanged = await data.updateAccount(cy, 'none', {})
    expect(unchanged?.user.name).toBe('Cy')
    const updated = await data.updateAccount(cy, 'none', {
      language: 'es',
      timeZone: 'Europe/Madrid',
      emails: { productNews: true },
    })
    expect(updated?.user).toEqual({
      name: 'Cy',
      email: 'cy@acme.com',
      language: 'es',
      timeZone: 'Europe/Madrid',
      emails: { productNews: true },
    })
    expect((await data.account(other, 'none'))?.user).toMatchObject({
      language: 'en',
      emails: { productNews: false },
    })
  })

  it('refuses to delete an owner of any organization', async () => {
    const owner = await insertUser(data, 'owner@oak.vc')
    const first = (await insertOrganization(data, { slug: 'oak-first' })).id
    const second = (await insertOrganization(data, { slug: 'oak-second' })).id
    await insertMember(data, first, owner, 'admin')
    await insertMember(data, second, owner, 'owner')
    await expect(data.deleteAccount(owner)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await data.memberOf(owner)).not.toBeNull()
  })

  it('deletes a person with their sessions, memberships and invitations to and from them', async () => {
    const org = (await insertOrganization(data, { slug: 'pine' })).id
    const owner = await insertUser(data, 'owner@pine.vc')
    const ana = await insertUser(data, 'ana@pine.vc')
    await insertMember(data, org, owner, 'owner')
    await insertMember(data, org, ana, 'admin')
    await session(ana, null)
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
    expect(await data.deleteAccount(ana)).toBe(true)
    expect(await data.deleteAccount(ana)).toBe(false)
    expect(await data.db.select().from(sessions).where(eq(sessions.userId, ana))).toEqual([])
    expect(await data.memberOf(owner)).toMatchObject({ role: 'owner' })
    expect(
      (await data.db.select().from(invitations).where(eq(invitations.organizationId, org))).map(
        (i) => i.email,
      ),
    ).toEqual(['lee@pine.vc'])
  })
})
