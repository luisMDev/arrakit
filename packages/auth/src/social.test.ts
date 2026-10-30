import { accounts, users } from '@arrakit/db/schema'
import { openTestData } from '@arrakit/db/testing'
import type { Mail } from '@arrakit/emails'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createAuth } from './auth'
import { loadAuthConfig } from './config'
import { microsoftVouches } from './social'

const WEB = 'http://localhost:5200'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const MICROSOFT_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

const unsignedJwt = (claims: Record<string, unknown>) =>
  [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ iat: 1, exp: 4102444800, ...claims })).toString('base64url'),
    '',
  ].join('.')

async function openAuth(env: Record<string, string>) {
  const data = await openTestData()
  const sent: Mail[] = []
  const auth = createAuth({
    config: loadAuthConfig({
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      BETTER_AUTH_URL: WEB,
      ...env,
    }),
    database: data.authDatabase,
    mailer: { send: async (mail) => void sent.push(mail) },
    invitationFor: async () => null,
    organizationOf: (userId) => data.organizationOf(userId),
  })
  return { auth, data, sent }
}

type Opened = Awaited<ReturnType<typeof openAuth>>

function startSocial(
  { auth }: Opened,
  provider: 'google' | 'microsoft',
  options: { origin?: string | null; callbackURL?: string; errorCallbackURL?: string } = {},
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const origin = options.origin === undefined ? WEB : options.origin
  if (origin !== null) headers.origin = origin
  return auth.handler(
    new Request(`${WEB}/api/auth/sign-in/social`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider,
        callbackURL: options.callbackURL ?? `${WEB}/profile`,
        errorCallbackURL: options.errorCallbackURL ?? `${WEB}/signup?via=${provider}`,
      }),
    }),
  )
}

const cookiesOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')

const sessionCookie = (res: Response) =>
  res.headers
    .getSetCookie()
    .find((c) => c.startsWith('arrakit.session_token='))
    ?.split(';')[0]

async function completeSocial(
  opened: Opened,
  provider: 'google' | 'microsoft',
  claims: Record<string, unknown>,
  query: Record<string, string> = { code: 'the-code' },
) {
  const start = await startSocial(opened, provider)
  const { url } = (await start.json()) as { url: string }
  const state = new URL(url).searchParams.get('state')!
  const tokenURL = provider === 'google' ? GOOGLE_TOKEN : MICROSOFT_TOKEN
  const realFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const target = input instanceof Request ? input.url : String(input)
    if (target.startsWith(tokenURL)) {
      return Response.json({
        access_token: 'raw-provider-access-token',
        id_token: unsignedJwt(claims),
        scope: 'openid email profile',
        expires_in: 3600,
        token_type: 'Bearer',
      })
    }
    return realFetch(input, init)
  })
  const params = new URLSearchParams({ state, ...query })
  return opened.auth.handler(
    new Request(`${WEB}/api/auth/callback/${provider}?${params}`, {
      headers: { cookie: cookiesOf(start) },
      redirect: 'manual',
    }),
  )
}

async function magicLinkUser(opened: Opened, email: string) {
  await opened.auth.handler(
    new Request(`${WEB}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB },
      body: JSON.stringify({ email, callbackURL: `${WEB}/profile` }),
    }),
  )
  const link = /https?:\/\/\S+\/api\/auth\/magic-link\/verify\?\S+/.exec(
    opened.sent.at(-1)!.text,
  )![0]
  const res = await opened.auth.handler(new Request(link, { redirect: 'manual' }))
  const session = await opened.auth.api.getSession({
    headers: new Headers({ cookie: sessionCookie(res)! }),
  })
  return session!.user.id
}

afterEach(() => vi.restoreAllMocks())

describe('Google sign-in', () => {
  let opened: Opened

  beforeAll(async () => {
    opened = await openAuth({
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
    })
  })
  afterAll(() => opened.data.close())

  it('answers with the consent URL and our redirect URI', async () => {
    const res = await startSocial(opened, 'google')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string; redirect: boolean }
    expect(body.redirect).toBe(true)
    const url = new URL(body.url)
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('redirect_uri')).toBe(`${WEB}/api/auth/callback/google`)
  })

  it.each([
    ['no Origin', null],
    ['null', 'null'],
    ['a lookalike host', 'http://localhost:5200.evil.example'],
    ['another scheme', 'https://localhost:5200'],
    ['another port', 'http://localhost:4201'],
    ['another site', 'https://evil.example'],
  ])('refuses %s', async (_, origin) => {
    expect((await startSocial(opened, 'google', { origin })).status).toBe(403)
  })

  it.each([
    'https://evil.example/profile',
    '//evil.example/profile',
    'http://localhost:5200@evil.example/profile',
    'http://localhost:5200.evil.example/profile',
  ])('refuses the callback %s in either field', async (bad) => {
    expect((await startSocial(opened, 'google', { callbackURL: bad })).status).toBe(403)
    expect((await startSocial(opened, 'google', { errorCallbackURL: bad })).status).toBe(403)
  })

  it('signs in with the name and email from Google and stores the token encrypted', async () => {
    const res = await completeSocial(opened, 'google', {
      sub: 'google-1',
      email: 'marta@acme.com',
      email_verified: true,
      name: 'Marta Ruiz',
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${WEB}/profile`)
    const session = await opened.auth.api.getSession({
      headers: new Headers({ cookie: sessionCookie(res)! }),
    })
    expect(session?.user).toMatchObject({ email: 'marta@acme.com', name: 'Marta Ruiz' })
    const rows = await opened.data.db.select().from(accounts)
    const google = rows.find((row) => row.providerId === 'google')!
    expect(google.accessToken).toBeTruthy()
    expect(google.accessToken).not.toBe('raw-provider-access-token')
  })

  it('sends a denial back to the error landing', async () => {
    const start = await startSocial(opened, 'google')
    const { url } = (await start.json()) as { url: string }
    const state = new URL(url).searchParams.get('state')!
    const res = await opened.auth.handler(
      new Request(`${WEB}/api/auth/callback/google?state=${state}&error=access_denied`, {
        headers: { cookie: cookiesOf(start) },
        redirect: 'manual',
      }),
    )
    expect(res.headers.get('location')).toBe(`${WEB}/signup?via=google&error=access_denied`)
    expect(sessionCookie(res)).toBeUndefined()
  })

  it('links Google to an existing magic-link user', async () => {
    const userId = await magicLinkUser(opened, 'linked@acme.com')
    const res = await completeSocial(opened, 'google', {
      sub: 'google-2',
      email: 'linked@acme.com',
      email_verified: true,
      name: 'Linked',
    })
    const session = await opened.auth.api.getSession({
      headers: new Headers({ cookie: sessionCookie(res)! }),
    })
    expect(session?.user.id).toBe(userId)
  })

  it('answers 404 for Microsoft when no Azure app is configured', async () => {
    expect((await startSocial(opened, 'microsoft')).status).toBe(404)
    expect((await startSocial(opened, 'google')).status).toBe(200)
  })
})

describe('Microsoft sign-in', () => {
  let opened: Opened
  let n = 0

  beforeAll(async () => {
    opened = await openAuth({
      MICROSOFT_CLIENT_ID: 'ms-id',
      MICROSOFT_CLIENT_SECRET: 'ms-secret',
    })
  })
  afterAll(() => opened.data.close())

  const claims = (extra: Record<string, unknown>, email = `ms-${++n}@acme.com`) => ({
    oid: `oid-${n}-${email}`,
    sub: `sub-${n}-${email}`,
    email,
    name: 'Ms Person',
    ...extra,
  })

  it('uses the common tenant', async () => {
    const { url } = (await (await startSocial(opened, 'microsoft')).json()) as { url: string }
    expect(url).toContain('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
  })

  it('refuses an untrusted Origin', async () => {
    expect(
      (await startSocial(opened, 'microsoft', { origin: 'https://evil.example' })).status,
    ).toBe(403)
  })

  const errorOf = (res: Response) => {
    const location = new URL(res.headers.get('location')!)
    return `${location.pathname}?via=${location.searchParams.get('via')}&error=${location.searchParams.get('error')}`
  }

  it.each([
    ['no claim', () => ({})],
    ['xms_edov false', () => ({ xms_edov: false })],
    ['verified_primary_email alone', (email: string) => ({ verified_primary_email: [email] })],
  ])('creates nothing for %s', async (_, extra) => {
    const email = `unvouched-${++n}@acme.com`
    const res = await completeSocial(opened, 'microsoft', claims(extra(email), email))
    expect(errorOf(res)).toBe('/signup?via=microsoft&error=email_not_verified')
    const userRows = await opened.data.db.select().from(users)
    expect(userRows.some((row) => row.email === email)).toBe(false)
    const accountRows = await opened.data.db.select().from(accounts)
    expect(accountRows.some((row) => row.accountId.includes(email))).toBe(false)
  })

  it.each([
    [{ email_verified: true }],
    [{ xms_edov: true }],
    [{ xms_edov: '1' }],
    [{ xms_edov: 'true' }],
  ])('signs in with vouched claims %j', async (extra) => {
    const res = await completeSocial(opened, 'microsoft', claims(extra))
    expect(res.headers.get('location')).toBe(`${WEB}/profile`)
    expect(sessionCookie(res)).toBeDefined()
  })

  it('links to an existing user only when vouched', async () => {
    const email = 'existing-ms@acme.com'
    const userId = await magicLinkUser(opened, email)
    const refused = await completeSocial(opened, 'microsoft', {
      ...claims({}, email),
      verified_primary_email: [email],
    })
    expect(errorOf(refused)).toBe('/signup?via=microsoft&error=account_not_linked')
    const linked = await completeSocial(opened, 'microsoft', claims({ xms_edov: '1' }, email))
    const session = await opened.auth.api.getSession({
      headers: new Headers({ cookie: sessionCookie(linked)! }),
    })
    expect(session?.user.id).toBe(userId)
  })
})

describe('microsoftVouches', () => {
  it.each([
    [{ email_verified: true }, true],
    [{ xms_edov: true }, true],
    [{ xms_edov: '1' }, true],
    [{ xms_edov: 'true' }, true],
    [{ xms_edov: 'false' }, false],
    [{ email_verified: 'true' }, false],
    [{ verified_primary_email: ['a@b.co'] }, false],
    [{}, false],
  ])('%j → %s', (claims, vouched) => expect(microsoftVouches(claims)).toBe(vouched))
})
