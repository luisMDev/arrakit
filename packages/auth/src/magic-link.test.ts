import { verifications } from '@arrakit/db/schema'
import { type TestData, openTestData } from '@arrakit/db/testing'
import type { Mail } from '@arrakit/emails'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createAuth } from './auth'
import { testOrganizationDeps } from './test-deps'
import { loadAuthConfig } from './config'
import type { InvitationForMail } from './deps'
import { invitationIdOf } from './magic-link'

const WEB = 'http://localhost:5200'
const config = loadAuthConfig({ BETTER_AUTH_SECRET: 'x'.repeat(32), BETTER_AUTH_URL: WEB })

describe('magic link sign-in (PGlite)', () => {
  let data: TestData
  let auth: ReturnType<typeof createAuth>
  const sent: Mail[] = []
  const invitations = new Map<string, { email: string; invitation: InvitationForMail }>()

  beforeAll(async () => {
    data = await openTestData()
    auth = createAuth({
      config,
      database: data.authDatabase,
      mailer: { send: async (mail) => void sent.push(mail) },
      invitationFor: async (id, email) => {
        const found = invitations.get(id)
        return found && found.email === email ? found.invitation : null
      },
      organizations: testOrganizationDeps(data),
    })
  })
  afterAll(() => data.close())
  afterEach(() => vi.useRealTimers())

  function requestLink(
    email: string,
    options: { origin?: string | null; callbackURL?: string; errorCallbackURL?: string } = {},
  ) {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const origin = options.origin === undefined ? WEB : options.origin
    if (origin !== null) headers.origin = origin
    return auth.handler(
      new Request(`${WEB}/api/auth/sign-in/magic-link`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email,
          callbackURL: options.callbackURL ?? `${WEB}/profile`,
          errorCallbackURL: options.errorCallbackURL ?? `${WEB}/signup`,
        }),
      }),
    )
  }

  async function linkFor(email: string, options?: Parameters<typeof requestLink>[1]) {
    const before = sent.length
    const res = await requestLink(email, options)
    expect(res.status).toBe(200)
    expect(sent.length).toBe(before + 1)
    const match = /https?:\/\/\S+\/api\/auth\/magic-link\/verify\?\S+/.exec(sent.at(-1)!.text)
    return match![0]
  }

  const open = (link: string, headers: Record<string, string> = {}) =>
    auth.handler(new Request(link, { redirect: 'manual', headers }))

  const cookieOf = (res: Response) =>
    res.headers
      .getSetCookie()
      .find((c) => c.startsWith('arrakit.session_token='))
      ?.split(';')[0]

  async function sessionOf(res: Response) {
    const cookie = cookieOf(res)
    if (!cookie) return null
    return auth.api.getSession({ headers: new Headers({ cookie }) })
  }

  it('sends MailSignin to the normalized address and signs in once', async () => {
    const link = await linkFor('  Ana.Ibarra@Seaya.CAPITAL ')
    const mail = sent.at(-1)!
    expect(mail.to).toBe('ana.ibarra@seaya.capital')
    expect(mail.subject).toBe('Your link to sign in to Arrakit')
    expect(mail.text).toContain(link)
    expect(mail.html).toContain(`href="${link.replaceAll('&', '&amp;')}"`)
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain('works once')
      expect(part).toContain('15 minutes')
    }

    const first = await open(link, {
      'x-real-ip': '203.0.113.9',
      'x-forwarded-for': '203.0.113.9, 162.158.1.1',
    })
    expect(first.status).toBe(302)
    expect(first.headers.get('location')).toBe(`${WEB}/profile`)
    const session = await sessionOf(first)
    expect(session?.user).toMatchObject({
      email: 'ana.ibarra@seaya.capital',
      emailVerified: true,
      name: '',
      language: 'en',
    })
    expect(session?.session.ipAddress).toBe('203.0.113.9')

    const again = await open(link)
    expect(again.status).toBe(302)
    expect(again.headers.get('location')).toBe(`${WEB}/signup?error=INVALID_TOKEN`)
    expect(cookieOf(again)).toBeUndefined()
  })

  it('treats differently cased addresses as one person', async () => {
    const a = await sessionOf(await open(await linkFor('lucia@alder.vc')))
    const b = await sessionOf(await open(await linkFor(' LUCIA@Alder.VC ')))
    expect(a?.user.id).toBe(b?.user.id)
  })

  it('keeps + aliases and punycode domains as typed', async () => {
    await linkFor('first.last+ic@organization.co.uk')
    expect(sent.at(-1)!.to).toBe('first.last+ic@organization.co.uk')
    await linkFor('ana@xn--mxail5aa.com')
    expect(sent.at(-1)!.to).toBe('ana@xn--mxail5aa.com')
  })

  it('lets one of two parallel clicks sign in', async () => {
    const link = await linkFor('parallel@acme.com')
    const results = await Promise.all([open(link), open(link)])
    const signedIn = results.filter((res) => cookieOf(res))
    expect(signedIn).toHaveLength(1)
    expect(results.map((r) => r.headers.get('location'))).toContain(
      `${WEB}/signup?error=INVALID_TOKEN`,
    )
  })

  it('keeps the earlier link working after asking again', async () => {
    const first = await linkFor('twice@acme.com')
    const second = await linkFor('twice@acme.com')
    expect(first).not.toBe(second)
    expect(cookieOf(await open(first))).toBeDefined()
    expect(cookieOf(await open(second))).toBeDefined()
  })

  it('signs in only the person the link was for', async () => {
    const link = await linkFor('only-a@acme.com')
    const session = await sessionOf(await open(link))
    expect(session?.user.email).toBe('only-a@acme.com')
  })

  it.each([
    [14 * 60 + 59, true],
    [15 * 60, true],
    [15 * 60 + 0.001, false],
    [16 * 60, false],
  ])('a link opened after %ss works: %s', async (seconds, works) => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-01T10:00:00Z') })
    const link = await linkFor(`clock-${seconds}@acme.com`)
    vi.setSystemTime(new Date(Date.parse('2026-01-01T10:00:00Z') + seconds * 1000))
    const res = await open(link)
    if (works) expect(cookieOf(res)).toBeDefined()
    else expect(res.headers.get('location')).toBe(`${WEB}/signup?error=INVALID_TOKEN`)
  })

  it('appends the error with & when the error URL already has a query', async () => {
    const link = await linkFor('query@acme.com', {
      errorCallbackURL: `${WEB}/signup?plan=team&cycle=monthly`,
    })
    await open(link)
    const res = await open(link)
    expect(res.headers.get('location')).toBe(
      `${WEB}/signup?plan=team&cycle=monthly&error=INVALID_TOKEN`,
    )
  })

  it.each([
    ['no Origin', null],
    ['null', 'null'],
    ['a lookalike host', 'http://localhost:5200.evil.example'],
    ['another scheme', 'https://localhost:5200'],
    ['another port', 'http://localhost:4201'],
    ['another site', 'https://evil.example'],
  ])('refuses %s with 403 and sends nothing', async (_, origin) => {
    const before = sent.length
    const res = await requestLink('ana@acme.com', { origin })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { message: string }).message).toBe('Sign in from the app.')
    expect(sent.length).toBe(before)
  })

  it.each(['', 'ana', 'ana@acme', 'lucia@cierzo.vc.'])(
    'refuses the unwritable email %j with 400 and sends nothing',
    async (email) => {
      const before = sent.length
      const res = await requestLink(email)
      expect(res.status).toBe(400)
      expect(((await res.json()) as { message: string }).message).toBe(
        'Enter a work email, like name@company.com.',
      )
      expect(sent.length).toBe(before)
    },
  )

  it('refuses a callback off a trusted origin', async () => {
    const res = await requestLink('ana@acme.com', { callbackURL: 'https://evil.example/profile' })
    expect(res.status).toBe(403)
  })

  it('sends MailMember for a join link addressed to the invitee', async () => {
    invitations.set('inv-1', {
      email: 'dana@oak.vc',
      invitation: {
        expiresAt: new Date(Date.now() + 2.5 * 24 * 60 * 60 * 1000),
        organization: { name: 'Oak' },
        inviter: { name: 'Owner Person', email: 'owner@oak.vc' },
      },
    })
    await linkFor('dana@oak.vc', { callbackURL: `${WEB}/join/inv-1` })
    const mail = sent.at(-1)!
    expect(mail.subject).toBe('Owner invited you to Oak on Arrakit')
    expect(mail.text).toContain('3 days')

    await linkFor('someone-else@oak.vc', { callbackURL: `${WEB}/join/inv-1` })
    expect(sent.at(-1)!.subject).toBe('Your link to sign in to Arrakit')
    await linkFor('dana@oak.vc', { callbackURL: `${WEB}/join/missing` })
    expect(sent.at(-1)!.subject).toBe('Your link to sign in to Arrakit')
  })

  it('closes the session-to-JWT route', async () => {
    const res = await auth.handler(
      new Request(`${WEB}/api/auth/token`, { headers: { origin: WEB } }),
    )
    expect(res.status).toBe(404)
  })

  it('never changes the language through update-user', async () => {
    const res = await open(await linkFor('lang@acme.com'))
    const cookie = cookieOf(res)!
    await auth.handler(
      new Request(`${WEB}/api/auth/update-user`, {
        method: 'POST',
        headers: { origin: WEB, cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ language: 'es', name: 'Lang' }),
      }),
    )
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) })
    expect(session?.user.language).toBe('en')
  })

  it('leaves no verification row after a link is used', async () => {
    await open(await linkFor('rows@acme.com'))
    const rows = await data.db.select().from(verifications)
    const values = rows.map((row) => row.value)
    expect(values.some((value) => value.includes('rows@acme.com'))).toBe(false)
  })

  it('revokes other sessions only', async () => {
    const mine = cookieOf(await open(await linkFor('revoke@acme.com')))!
    const other = cookieOf(await open(await linkFor('revoke@acme.com')))!
    const stranger = cookieOf(await open(await linkFor('stranger@acme.com')))!
    const res = await auth.handler(
      new Request(`${WEB}/api/auth/revoke-other-sessions`, {
        method: 'POST',
        headers: { origin: WEB, cookie: mine, 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(res.status).toBe(200)
    const sessionFor = (cookie: string) => auth.api.getSession({ headers: new Headers({ cookie }) })
    expect(await sessionFor(mine)).not.toBeNull()
    expect(await sessionFor(other)).toBeNull()
    expect(await sessionFor(stranger)).not.toBeNull()
  })
})

describe('invitationIdOf', () => {
  const link = (callbackURL: string) =>
    `${WEB}/api/auth/magic-link/verify?token=t&callbackURL=${encodeURIComponent(callbackURL)}`

  it.each([
    [`${WEB}/join/abc`, 'abc'],
    ['/join/a%20b', 'a b'],
    [`${WEB}/join/abc/extra`, null],
    ['https://evil.example/join/abc', null],
    [`${WEB}/profile`, null],
  ])('%s → %j', (callbackURL, id) => expect(invitationIdOf(link(callbackURL), config)).toBe(id))
})
