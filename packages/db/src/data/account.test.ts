import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PersonOwnsOrganizationError } from '../errors'
import { accounts, invitations, members, organizations, sessions, users } from '../schema/index'
import { type TestData, openTestData } from '../testing'

describe('account', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  const person = async (email: string, name = ''): Promise<string> => {
    const id = randomUUID()
    await data.db.insert(users).values({ id, name, email })
    return id
  }
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
  const organization = async (slug: string) => {
    const [row] = await data.db.insert(organizations).values({ name: slug, slug }).returning()
    return row!.id
  }

  it('reads a fresh person: email sign-in, defaults, the current session first', async () => {
    const ana = await person('ana@acme.com')
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
    const bo = await person('bo@acme.com')
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
    const cy = await person('cy@acme.com', 'Cy')
    const other = await person('dee@acme.com', 'Dee')
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
    expect(await data.languageOf(cy)).toBe('es')
    expect(await data.languageOf(other)).toBe('en')
    expect(await data.languageOf('nobody')).toBe('en')
    expect(await data.wantsEmail(' CY@acme.com', 'productNews')).toBe(true)
    expect(await data.wantsEmail('dee@acme.com', 'productNews')).toBe(false)
    expect(await data.wantsEmail('stranger@acme.com', 'productNews')).toBe(true)
  })

  it('refuses to delete an owner of any organization', async () => {
    const owner = await person('owner@oak.vc')
    const first = await organization('oak-first')
    const second = await organization('oak-second')
    await data.db.insert(members).values({ organizationId: first, userId: owner, role: 'admin' })
    await data.db.insert(members).values({ organizationId: second, userId: owner, role: 'owner' })
    await expect(data.deleteAccount(owner)).rejects.toBeInstanceOf(PersonOwnsOrganizationError)
    expect(await data.memberOf(owner)).not.toBeNull()
  })

  it('deletes a person with their sessions, memberships and invitations to and from them', async () => {
    const org = await organization('pine')
    const owner = await person('owner@pine.vc')
    const ana = await person('ana@pine.vc')
    await data.db.insert(members).values({ organizationId: org, userId: owner, role: 'owner' })
    await data.db.insert(members).values({ organizationId: org, userId: ana, role: 'admin' })
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
