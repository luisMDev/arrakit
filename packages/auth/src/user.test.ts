import { invitations, members, users } from '@arrakit/db/schema'
import { type TestData, insertMember, insertOrganization, openTestData } from '@arrakit/db/testing'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createAuth } from './auth'
import { loadAuthConfig } from './config'
import { testOrganizationDeps } from './test-deps'
import { OWNER_KEEPS_ACCOUNT } from './user'

const WEB = 'http://localhost:5200'
const DAY_MS = 86_400_000
const config = loadAuthConfig({ BETTER_AUTH_SECRET: 'x'.repeat(32), BETTER_AUTH_URL: WEB })

/** `name=value` pairs of `cookie`, replaced by what `res` sets. */
function withSetCookies(cookie: string, res: Response): string {
  const jar = new Map(
    cookie
      .split('; ')
      .filter(Boolean)
      .map((pair) => [pair.slice(0, pair.indexOf('=')), pair] as const),
  )
  for (const set of res.headers.getSetCookie()) {
    const pair = set.split(';')[0]!
    jar.set(pair.slice(0, pair.indexOf('=')), pair)
  }
  return [...jar.values()].join('; ')
}

describe('the person’s own account through Better Auth (PGlite)', () => {
  let data: TestData
  let auth: ReturnType<typeof createAuth>

  beforeAll(async () => {
    data = await openTestData()
    auth = createAuth({
      config,
      data,
      mailer: { send: async () => {} },
      organizations: testOrganizationDeps,
      testing: true,
    })
  })
  afterAll(() => data.close())
  afterEach(() => vi.useRealTimers())

  async function signedIn(email: string, name = '') {
    const { test } = await auth.$context
    const user = await test.saveUser(test.createUser({ email, name }))
    const { headers } = await test.login({ userId: user.id })
    return { userId: user.id, cookie: headers.get('cookie')! }
  }

  async function post(path: string, cookie: string, body: Record<string, unknown>) {
    const res = await auth.handler(
      new Request(`${WEB}/api/auth${path}`, {
        method: 'POST',
        headers: { origin: WEB, cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
    const answer = (await res.json().catch(() => null)) as Record<string, unknown> | null
    return { status: res.status, body: answer, cookie: withSetCookies(cookie, res) }
  }

  /** The cookies after a session read, the cached session among them. */
  async function withCachedSession(cookie: string) {
    const res = await auth.handler(
      new Request(`${WEB}/api/auth/get-session`, { headers: { origin: WEB, cookie } }),
    )
    expect(res.headers.getSetCookie().join()).toMatch(/arrakit\.session_data=/)
    return withSetCookies(cookie, res)
  }

  const sessionOf = (cookie: string) => auth.api.getSession({ headers: new Headers({ cookie }) })
  const userRow = async (userId: string) =>
    (await data.db.select().from(users)).find((row) => row.id === userId)

  describe('update-user', () => {
    it('saves the name trimmed and the settings, and rewrites the cached session', async () => {
      const { userId, cookie } = await signedIn('ana@acme.com', 'Old')
      const stale = await withCachedSession(cookie)
      const saved = await post('/update-user', stale, {
        name: '  Ana Pérez ',
        language: 'es',
        timeZone: 'Europe/Madrid',
        emailProductNews: true,
      })
      expect(saved.status).toBe(200)
      expect(await userRow(userId)).toMatchObject({
        name: 'Ana Pérez',
        language: 'es',
        timeZone: 'Europe/Madrid',
        emailProductNews: true,
      })
      expect((await sessionOf(saved.cookie))?.user).toMatchObject({
        name: 'Ana Pérez',
        language: 'es',
      })
    })

    it.each([
      [{ name: '   ' }, 'Enter your name.'],
      [{ name: 'Ana\nPérez' }, 'Keep your name on one line.'],
      [{ name: 'a'.repeat(101) }, 'Keep your name to 100 characters.'],
      [{ language: 'fr' }, 'Pick a language from the list.'],
      [{ timeZone: 'europe/madrid' }, 'Pick a time zone from the list.'],
      [{ timeZone: '+02:00' }, 'Pick a time zone from the list.'],
      [{ emailProductNews: 'no' }, 'Choose whether to get product news.'],
      [{ image: 'https://example.com/me.png' }, 'Only your name and settings change here.'],
    ])('refuses %j, saving nothing', async (body, message) => {
      const { userId, cookie } = await signedIn(`refused-${crypto.randomUUID()}@acme.com`, 'Kept')
      const before = await userRow(userId)
      const refused = await post('/update-user', cookie, body)
      expect(refused).toMatchObject({ status: 400, body: { message } })
      expect(await userRow(userId)).toEqual(before)
    })
  })

  describe('delete-user', () => {
    it('deletes a person who owns nothing, with the invitations addressed to them', async () => {
      const org = (await insertOrganization(data, { slug: 'pine' })).id
      const owner = await signedIn('owner@pine.vc')
      await insertMember(data, org, owner.userId, 'owner')
      const ana = await signedIn('ana@pine.vc')
      await insertMember(data, org, ana.userId, 'admin')
      const expiresAt = new Date(Date.now() + DAY_MS)
      await data.db.insert(invitations).values([
        { organizationId: org, email: 'ana@pine.vc', inviterId: owner.userId, expiresAt },
        { organizationId: org, email: 'lee@pine.vc', inviterId: owner.userId, expiresAt },
      ])

      const deleted = await post('/delete-user', ana.cookie, {})
      expect(deleted).toMatchObject({ status: 200, body: { success: true } })
      expect(deleted.cookie).not.toMatch(/arrakit\.session_token=[^;]/)
      expect(await sessionOf(ana.cookie)).toBeNull()
      expect(await userRow(ana.userId)).toBeUndefined()
      expect(
        (await data.db.select().from(invitations))
          .filter((i) => i.organizationId === org)
          .map((i) => i.email),
      ).toEqual(['lee@pine.vc'])
    })

    it('keeps an owner, signed in', async () => {
      const org = (await insertOrganization(data, { slug: 'oak' })).id
      const owner = await signedIn('owner@oak.vc')
      await insertMember(data, org, owner.userId, 'owner')
      expect(await post('/delete-user', owner.cookie, {})).toMatchObject({
        status: 409,
        body: { message: OWNER_KEEPS_ACCOUNT },
      })
      expect(await sessionOf(owner.cookie)).not.toBeNull()
    })

    it('asks for a fresh sign-in once the session is a day old', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date() })
      const person = await signedIn('late@acme.com')
      vi.setSystemTime(Date.now() + DAY_MS + 60_000)
      expect(await post('/delete-user', person.cookie, {})).toMatchObject({
        status: 400,
        body: { code: 'SESSION_EXPIRED' },
      })
      expect(await userRow(person.userId)).toBeDefined()
    })
  })

  describe('organization/create', () => {
    const creatorSeat = async (organizationId: string) =>
      (await data.db.select().from(members)).filter((m) => m.organizationId === organizationId)

    it('stamps the terms the creator accepted and caches the new organization as active', async () => {
      const person = await signedIn('terms@birch.vc')
      const created = await post('/organization/create', await withCachedSession(person.cookie), {
        name: 'Birch',
        slug: 'pending',
        termsAccepted: true,
      })
      expect(created).toMatchObject({ status: 200, body: { name: 'Birch', slug: 'birch' } })
      const id = String(created.body!.id)
      const [seat] = await creatorSeat(id)
      expect(seat).toMatchObject({ role: 'owner', termsAcceptedAt: expect.any(Date) })
      expect((await sessionOf(created.cookie))?.session.activeOrganizationId).toBe(id)
    })

    it('leaves the terms unstamped when none were sent', async () => {
      const person = await signedIn('plain@cedar.vc')
      const created = await post('/organization/create', person.cookie, { name: '', slug: 'x' })
      expect(created.body).toMatchObject({ name: 'Cedar', slug: 'cedar' })
      const [seat] = await creatorSeat(String(created.body!.id))
      expect(seat?.termsAcceptedAt).toBeNull()
    })

    it.each([false, 'true'])(
      'refuses termsAccepted %j, creating nothing',
      async (termsAccepted) => {
        const person = await signedIn(`refused-${String(termsAccepted)}@maple.vc`)
        expect(
          await post('/organization/create', person.cookie, {
            name: 'Maple',
            slug: 'x',
            termsAccepted,
          }),
        ).toMatchObject({
          status: 400,
          body: { message: 'Accept the Terms and the Privacy Policy.' },
        })
        expect(await data.memberOf(person.userId)).toBeNull()
      },
    )
  })
})
