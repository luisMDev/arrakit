import { expect, test } from '@playwright/test'

import { magicLinkFor } from './mailpit'
import { API_ORIGIN, WEB_ORIGIN } from './origins'
import { uniqueEmail } from './session'

test('serves the OAuth authorization server metadata through the web origin', async ({
  request,
}) => {
  const res = await request.get(`${WEB_ORIGIN}/.well-known/oauth-authorization-server/api/auth`)
  expect(res.status()).toBe(200)
  const body = (await res.json()) as { issuer: string; token_endpoint: string }
  expect(body.issuer).toBe(`${WEB_ORIGIN}/api/auth`)
  expect(body.token_endpoint.startsWith(WEB_ORIGIN)).toBe(true)
  const direct = await request.get(`${API_ORIGIN}/.well-known/oauth-authorization-server/api/auth`)
  expect(await direct.json()).toEqual(body)
})

test('serves the OpenID discovery document and the signing keys through the web origin', async ({
  request,
}) => {
  const res = await request.get(`${WEB_ORIGIN}/api/auth/.well-known/openid-configuration`)
  expect(res.status()).toBe(200)
  const discovery = (await res.json()) as { issuer: string; jwks_uri: string }
  expect(discovery.issuer).toBe(`${WEB_ORIGIN}/api/auth`)
  expect(discovery.jwks_uri).toBe(`${WEB_ORIGIN}/api/auth/jwks`)

  const jwks = await request.get(discovery.jwks_uri)
  expect(jwks.status()).toBe(200)
  const { keys } = (await jwks.json()) as { keys: Record<string, unknown>[] }
  expect(keys).toHaveLength(1)
  expect(keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', kid: expect.any(String) })
  expect(keys[0]).not.toHaveProperty('d')
})

test('serves the MCP protected resource metadata through the web origin', async ({ request }) => {
  const res = await request.get(`${WEB_ORIGIN}/.well-known/oauth-protected-resource/api/mcp`)
  expect(res.status()).toBe(200)
  expect(((await res.json()) as { resource: string }).resource).toBe(`${WEB_ORIGIN}/api/mcp`)
})

// With NODE_ENV=test Better Auth falls back to 127.0.0.1 when no forwarded IP reaches it, so
// x-forwarded-for cannot be told apart from that fallback here; the edge's x-real-ip can. The
// proxy's xfwd and single-IP x-forwarded-for are covered by src/server/api-proxy-handler.test.ts.
test('forwards POST bodies, leaves redirects to the browser and records the client IP', async ({
  request,
}) => {
  const email = uniqueEmail('proxy')
  const asked = await request.post(`${WEB_ORIGIN}/api/auth/sign-in/magic-link`, {
    headers: { origin: WEB_ORIGIN },
    data: { email, callbackURL: `${WEB_ORIGIN}/profile` },
  })
  expect(asked.status(), await asked.text()).toBe(200)

  const link = await magicLinkFor(request, email)
  expect(link.startsWith(WEB_ORIGIN)).toBe(true)

  const opened = await request.get(link, {
    maxRedirects: 0,
    headers: { 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.9, 198.51.100.1' },
  })
  expect(opened.status()).toBe(302)
  expect(opened.headers().location).toContain('/profile')
  expect(opened.headers()['set-cookie']).toMatch(/session_token=/)

  const session = await request.get(`${WEB_ORIGIN}/api/auth/get-session`)
  const body = (await session.json()) as { session: { ipAddress?: string | null } } | null
  expect(body?.session.ipAddress).toBe('203.0.113.9')
})
