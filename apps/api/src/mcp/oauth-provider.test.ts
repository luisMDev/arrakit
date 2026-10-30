import { oauthClientResources, oauthClients } from '@arrakit/db/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  CLAUDE_CALLBACK,
  TEST_MCP_URL,
  TEST_WEB_ORIGIN,
  type TestApp,
  createTestApp,
  jwtPayload,
  pkcePair,
  sessionCookieOf,
} from '../testing/app'

const ISSUER = `${TEST_WEB_ORIGIN}/api/auth`
const SIGNED_PARAMS = ['sig', 'exp', 'ba_iat', 'ba_pl', 'ba_param']

describe('the OAuth 2.1 provider for the MCP connector', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  const sessionUserId = async (cookie: string) => {
    const res = await t.request('/api/auth/get-session', { headers: { cookie } })
    return ((await res.json()) as { user: { id: string } }).user.id
  }

  const owner = async (email: string, name: string) => {
    const cookie = await t.magicLinkSignIn(email)
    const organization = await t
      .client(new Headers({ cookie }))
      .onboarding.create({ name, termsAccepted: true })
    return { cookie, organization }
  }

  it('publishes authorization server metadata with PKCE and without client credentials', async () => {
    const res = await t.request('/.well-known/oauth-authorization-server/api/auth')
    expect(res.status).toBe(200)
    const metadata = (await res.json()) as Record<string, unknown>
    expect(metadata).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth2/authorize`,
      token_endpoint: `${ISSUER}/oauth2/token`,
      registration_endpoint: `${ISSUER}/oauth2/register`,
    })
    expect(metadata.code_challenge_methods_supported).toContain('S256')
    expect(metadata.grant_types_supported).toContain('refresh_token')
    expect(metadata.grant_types_supported).not.toContain('client_credentials')
  })

  it('also answers the metadata under the issuer path (RFC 8414 fallback some clients use)', async () => {
    const res = await t.request('/api/auth/.well-known/oauth-authorization-server')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { issuer: string }).issuer).toBe(ISSUER)
  })

  it('registers a public client without a session and links it to the MCP resource', async () => {
    const res = await t.request('/api/auth/oauth2/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Claude',
        redirect_uris: [CLAUDE_CALLBACK],
        token_endpoint_auth_method: 'none',
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { client_id: string; redirect_uris: string[] }
    expect(body.redirect_uris).toEqual([CLAUDE_CALLBACK])

    const clients = await t.data.db.select().from(oauthClients)
    const stored = clients.find((client) => client.clientId === body.client_id)
    expect(stored).toMatchObject({ name: 'Claude', redirectUris: [CLAUDE_CALLBACK] })
    const links = await t.data.db.select().from(oauthClientResources)
    expect(links.filter((link) => link.clientId === body.client_id)).toEqual([
      expect.objectContaining({ resourceId: TEST_MCP_URL }),
    ])
  })

  it('closes the session-to-JWT route', async () => {
    const { headers } = await t.signIn({ email: 'closed@acme.com' })
    expect((await t.request('/api/auth/token', { headers })).status).toBe(404)
  })

  it('refuses a magic link asked for without a trusted Origin', async () => {
    const res = await t.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'no-origin@acme.com', callbackURL: '/' }),
    })
    expect(res.status).toBe(403)
  })

  it('sends a signed-out person to the web sign-in page with a signed query', async () => {
    const clientId = await t.connector.register()
    const res = await t.connector.authorize(clientId, pkcePair().challenge)
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.origin + location.pathname).toBe(`${TEST_WEB_ORIGIN}/oauth/signin`)
    expect(location.searchParams.get('client_id')).toBe(clientId)
    expect(location.searchParams.get('sig')).toBeTruthy()
  })

  it('issues a JWT for the MCP resource with the organization claim, and refreshes it', async () => {
    const { cookie, organization } = await owner('lucia@ardent.vc', 'Ardent Ventures')
    const clientId = await t.connector.register()
    const pkce = pkcePair()

    const authorized = await t.connector.authorize(clientId, pkce.challenge, cookie)
    expect(authorized.status).toBe(302)
    const consentPage = new URL(authorized.headers.get('location') ?? '')
    expect(consentPage.origin + consentPage.pathname).toBe(`${TEST_WEB_ORIGIN}/oauth/consent`)
    expect(consentPage.searchParams.get('client_id')).toBe(clientId)

    const consented = await t.connector.consent(cookie, consentPage.search.slice(1), true)
    const { url } = (await consented.json()) as { url: string }
    const back = new URL(url)
    expect(back.origin + back.pathname).toBe(CLAUDE_CALLBACK)
    expect(back.searchParams.get('state')).toBe('claude-state')
    const code = back.searchParams.get('code')!

    const exchange = (verifier: string) =>
      t.connector.token({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: CLAUDE_CALLBACK,
        client_id: clientId,
        resource: TEST_MCP_URL,
      })

    const res = await exchange(pkce.verifier)
    expect(res.status).toBe(200)
    const tokens = (await res.json()) as Record<string, string>
    expect(tokens).toMatchObject({ token_type: expect.stringMatching(/bearer/i) })
    expect(tokens.refresh_token).toBeTruthy()
    expect(tokens.expires_in).toBeTruthy()
    const claims = jwtPayload(tokens.access_token!)
    expect(claims).toMatchObject({
      sub: await sessionUserId(cookie),
      organization_id: organization.id,
      iss: ISSUER,
    })
    expect([claims.aud].flat()).toContain(TEST_MCP_URL)

    const refreshed = await t.connector.refresh(clientId, tokens.refresh_token!)
    expect(refreshed.status).toBe(200)
    const next = (await refreshed.json()) as Record<string, string>
    expect(next.access_token).not.toBe(tokens.access_token)
    expect(jwtPayload(next.access_token!).organization_id).toBe(organization.id)
  })

  it('issues no token for a wrong PKCE verifier', async () => {
    const { cookie } = await owner('pkce@ardent.vc', 'Pkce Ventures')
    const clientId = await t.connector.register()
    const pkce = pkcePair()
    const authorized = await t.connector.authorize(clientId, pkce.challenge, cookie)
    const query = new URL(authorized.headers.get('location') ?? '').search.slice(1)
    const { url } = (await (await t.connector.consent(cookie, query, true)).json()) as {
      url: string
    }
    const res = await t.connector.token({
      grant_type: 'authorization_code',
      code: new URL(url).searchParams.get('code')!,
      code_verifier: pkcePair().verifier,
      redirect_uri: CLAUDE_CALLBACK,
      client_id: clientId,
      resource: TEST_MCP_URL,
    })
    expect(res.ok).toBe(false)
    expect(await res.json()).not.toHaveProperty('access_token')
  })

  it('refuses consent to a person with no organization; a denial goes back with access_denied', async () => {
    const cookie = await t.magicLinkSignIn('loner@ardent.vc')
    const clientId = await t.connector.register()

    const authorized = await t.connector.authorize(clientId, pkcePair().challenge, cookie)
    expect(authorized.status).toBe(302)
    const consentPage = new URL(authorized.headers.get('location') ?? '')
    expect(consentPage.pathname).toBe('/oauth/consent')
    const query = consentPage.search.slice(1)

    const accepted = (await (await t.connector.consent(cookie, query, true)).json()) as Record<
      string,
      unknown
    >
    expect(accepted.url).toBeUndefined()
    expect(accepted.error).toBe('access_denied')

    const denied = (await (await t.connector.consent(cookie, query, false)).json()) as {
      url: string
    }
    const back = new URL(denied.url)
    expect(back.origin + back.pathname).toBe(CLAUDE_CALLBACK)
    expect(back.searchParams.get('error')).toBe('access_denied')
    expect(back.searchParams.get('code')).toBeNull()
  })

  it('resumes the authorization after a magic link sign-in', async () => {
    const email = 'resume@ardent.vc'
    await owner(email, 'Resume Ventures')
    const clientId = await t.connector.register()
    const signinPage = new URL(
      (await t.connector.authorize(clientId, pkcePair().challenge)).headers.get('location') ?? '',
    )
    const resumeQuery = new URLSearchParams(signinPage.search)
    for (const name of SIGNED_PARAMS) resumeQuery.delete(name)
    const callbackURL = `${TEST_WEB_ORIGIN}/api/auth/oauth2/authorize?${resumeQuery}`

    const asked = await t.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: TEST_WEB_ORIGIN },
      body: JSON.stringify({ email, callbackURL, errorCallbackURL: `${TEST_WEB_ORIGIN}/signup` }),
    })
    expect(asked.status).toBe(200)
    const link = new URL(t.linkFor(email))
    const opened = await t.request(link.pathname + link.search, { redirect: 'manual' })
    expect(opened.status).toBe(302)
    expect(opened.headers.get('location')).toBe(callbackURL)
    const cookie = sessionCookieOf(opened)!

    const resumed = new URL(callbackURL)
    const again = await t.request(resumed.pathname + resumed.search, {
      headers: { cookie },
      redirect: 'manual',
    })
    expect(again.status).toBe(302)
    const consent = new URL(again.headers.get('location') ?? '')
    expect(consent.pathname).toBe('/oauth/consent')
    expect(consent.searchParams.get('client_id')).toBe(clientId)
  })

  it('serves its signing keys with one key row after first use', async () => {
    const res = await t.request('/api/auth/jwks')
    expect(res.status).toBe(200)
    const { keys } = (await res.json()) as { keys: { kid: string }[] }
    const { jwks } = await import('@arrakit/db/schema')
    const rows = await t.data.db.select().from(jwks)
    expect(rows).toHaveLength(1)
    expect(keys.map((key) => key.kid)).toEqual(rows.map((row) => row.id))
  })
})
