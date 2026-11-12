import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { authApi, createOrganization, joined, ownerOf } from '../testing/people'
import { TEST_WEB_ORIGIN, type TestApp, createTestApp } from '../testing/app'

const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

describe('me and account', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())
  afterEach(() => vi.useRealTimers())

  /** Every cookie a browser keeps from opening the magic link, the cached session included. */
  const browserCookies = async (email: string) => {
    await t.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: TEST_WEB_ORIGIN },
      body: JSON.stringify({ email, callbackURL: `${TEST_WEB_ORIGIN}/app` }),
    })
    const link = new URL(t.linkFor(email))
    const opened = await t.request(link.pathname + link.search, { redirect: 'manual' })
    return opened.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ')
  }

  const signInFrom = async (email: string, userAgent: string) =>
    new Headers({
      cookie: await t.magicLinkSignIn(email, userAgent),
      origin: TEST_WEB_ORIGIN,
      'user-agent': userAgent,
    })

  it('reads me before and after an organization exists', async () => {
    const { headers } = await t.signIn({ email: 'dana@elm.vc' })
    await expect(t.client(headers).me.get()).resolves.toEqual({
      email: 'dana@elm.vc',
      name: '',
      language: 'en',
      organization: null,
      role: null,
      permissions: {},
      plan: null,
      seats: null,
    })
    await authApi(t, headers).post('update-user', { name: 'Lucía Gómez' })
    await createOrganization(t, headers)
    await expect(t.client(headers).me.get()).resolves.toMatchObject({
      name: 'Lucía Gómez',
      organization: { name: 'Elm', slug: 'elm', plan: 'free' },
      role: 'owner',
      plan: 'free',
      seats: 1,
    })
  })

  it('reads a fresh account', async () => {
    const { headers } = await t.signIn({ email: 'fresh@acme.com' })
    await expect(t.client(headers).me.account.get()).resolves.toEqual({
      name: '',
      email: 'fresh@acme.com',
      signInWith: 'email',
      devices: ['browser'],
      language: 'en',
      timeZone: null,
      emails: { productNews: false },
    })
    await expect(t.client().me.account.get()).rejects.toMatchObject({ status: 401 })
  })

  it('lists devices with the current one first', async () => {
    const laptop = await signInFrom('two@devices.vc', MAC)
    const phone = await signInFrom('two@devices.vc', IPHONE)
    expect((await t.client(laptop).me.account.get()).devices).toEqual(['Mac', 'iPhone'])
    expect((await t.client(phone).me.account.get()).devices).toEqual(['iPhone', 'Mac'])
  })

  it('signs out every other device, keeping this one', async () => {
    const laptop = await signInFrom('out@devices.vc', MAC)
    const phone = await signInFrom('out@devices.vc', IPHONE)
    const other = await signInFrom('someone@devices.vc', IPHONE)
    const res = await t.app.request('/api/auth/revoke-other-sessions', {
      method: 'POST',
      headers: { ...Object.fromEntries(laptop), 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
    expect((await t.client(laptop).me.account.get()).devices).toEqual(['Mac'])
    await expect(t.client(phone).me.get()).rejects.toMatchObject({ status: 401 })
    await expect(t.client(other).me.get()).resolves.toMatchObject({ email: 'someone@devices.vc' })
    const anonymous = await t.app.request('/api/auth/revoke-other-sessions', {
      method: 'POST',
      headers: { origin: TEST_WEB_ORIGIN, 'content-type': 'application/json' },
      body: '{}',
    })
    expect(anonymous.status).toBe(401)
  })

  it('shows a new name and language at once, through the cookie update-user rewrites', async () => {
    const cookie = await browserCookies('fresh@devices.vc')
    const res = await t.request('/api/auth/update-user', {
      method: 'POST',
      headers: { cookie, origin: TEST_WEB_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ana Ibarra', language: 'es' }),
    })
    expect(res.status).toBe(200)
    const rewritten = res.headers.getSetCookie().map((set) => set.split(';')[0])
    expect(rewritten.some((pair) => pair?.includes('session_data='))).toBe(true)
    const headers = new Headers({ cookie: rewritten.join('; '), origin: TEST_WEB_ORIGIN })
    await expect(t.client(headers).me.get()).resolves.toMatchObject({
      name: 'Ana Ibarra',
      language: 'es',
    })
  })

  it('lets a signed-out device pass the session check for up to five minutes, never me.get', async () => {
    const laptop = await signInFrom('cache@devices.vc', MAC)
    const phone = new Headers({ cookie: await browserCookies('cache@devices.vc') })
    expect(phone.get('cookie')).toContain('session_data=')
    await t.app.request('/api/auth/revoke-other-sessions', {
      method: 'POST',
      headers: { ...Object.fromEntries(laptop), 'content-type': 'application/json' },
      body: '{}',
    })
    // Signed in still: past the session check, refused only for having no organization.
    await expect(t.client(phone).usage.get()).rejects.toMatchObject({ status: 404 })
    await expect(t.client(phone).me.get()).rejects.toMatchObject({ status: 401 })
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 6 * 60 * 1000 })
    await expect(t.client(phone).usage.get()).rejects.toMatchObject({ status: 401 })
  })

  it('updates only what is sent, trimmed, and reflects the name in me', async () => {
    const { headers } = await t.signIn({ email: 'up@acme.com', name: 'Old' })
    const other = await t.signIn({ email: 'other@acme.com', name: 'Other' })
    const update = (body: Record<string, unknown>) => authApi(t, headers).post('update-user', body)
    expect(await update({ language: 'es' })).toMatchObject({ status: 200 })
    await expect(t.client(headers).me.account.get()).resolves.toMatchObject({
      name: 'Old',
      language: 'es',
    })
    expect(
      await update({ name: '  Ana Pérez ', timeZone: 'Asia/Kolkata', emailProductNews: true }),
    ).toMatchObject({ status: 200 })
    await expect(t.client(headers).me.account.get()).resolves.toMatchObject({
      name: 'Ana Pérez',
      language: 'es',
      timeZone: 'Asia/Kolkata',
      emails: { productNews: true },
    })
    await expect(t.client(headers).me.get()).resolves.toMatchObject({
      name: 'Ana Pérez',
      language: 'es',
    })
    await expect(t.client(other.headers).me.account.get()).resolves.toMatchObject({
      name: 'Other',
      language: 'en',
    })
  })

  it.each([
    ['a blank name', { name: '   ' }],
    ['a name with a line break', { name: 'Ana\nPérez' }],
    ['a name past 100 characters', { name: 'a'.repeat(101) }],
    ['an unknown language', { language: 'fr' }],
    ['a lower-case zone', { timeZone: 'europe/madrid' }],
    ['an offset', { timeZone: '+02:00' }],
    ['a non-boolean email choice', { emailProductNews: 'no' }],
    ['an email', { email: 'new@acme.com' }],
    ['a picture', { image: 'https://example.com/me.png' }],
  ])('refuses %s with 400, saving nothing', async (label, body) => {
    const email = `strict-${label.replace(/\W+/g, '-')}@acme.com`
    const { headers } = await t.signIn({ email, name: 'Strict' })
    expect((await authApi(t, headers).post('update-user', body)).status).toBe(400)
    await expect(t.client(headers).me.account.get()).resolves.toMatchObject({
      name: 'Strict',
      email,
      language: 'en',
      timeZone: null,
      emails: { productNews: false },
    })
  })

  describe('delete', () => {
    it('refuses an owner with 409 and keeps them signed in', async () => {
      const owner = await ownerOf(t, 'owner@oak.vc')
      expect(await authApi(t, owner.headers).post('delete-user')).toMatchObject({
        status: 409,
        body: {
          message:
            'You own an organization. Delete the organization first, in Settings → Security and data.',
        },
      })
      await expect(t.client(owner.headers).me.get()).resolves.toMatchObject({ role: 'owner' })
    })

    it('deletes an invited admin: every session ends and the organization keeps its owner', async () => {
      const owner = await ownerOf(t, 'owner@pine.vc')
      const admin = await joined(t, owner, 'ana@pine.vc', 'admin')
      const phone = await signInFrom('ana@pine.vc', IPHONE)
      const deleted = await authApi(t, admin.headers).post('delete-user')
      expect(deleted).toMatchObject({ status: 200, body: { success: true } })
      await expect(t.client(admin.headers).me.get()).rejects.toMatchObject({ status: 401 })
      await expect(t.client(phone).me.get()).rejects.toMatchObject({ status: 401 })
      expect(
        (await t.data.asSystem(owner.organizationId).members.list()).map((m) => m.email),
      ).toEqual(['owner@pine.vc'])
      expect((await authApi(t, new Headers()).post('delete-user')).status).toBe(401)
    })

    it('asks a session older than a day to sign in again, deleting nothing', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date() })
      const owner = await ownerOf(t, 'owner@larch.vc')
      const member = await joined(t, owner, 'late@larch.vc')
      vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000)
      expect(await authApi(t, member.headers).post('delete-user')).toMatchObject({
        status: 400,
        body: { code: 'SESSION_EXPIRED' },
      })
      await expect(t.client(member.headers).me.get()).resolves.toMatchObject({
        email: 'late@larch.vc',
      })
    })
  })
})
