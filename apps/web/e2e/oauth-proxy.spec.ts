import { expect, test } from '@playwright/test'

import { magicLinkFor } from './mailpit'
import { API_ORIGIN, WEB_ORIGIN } from './origins'
import { uniqueEmail } from './session'

// The web server (the Nitro handler in src/server/api-proxy-handler.ts) proxies /api/** and the OAuth metadata
// under /.well-known/oauth-* to the API, so web and API are one site. Every request here goes to
// the WEB origin.

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

test('serves the MCP protected resource metadata through the web origin', async ({ request }) => {
  const res = await request.get(`${WEB_ORIGIN}/.well-known/oauth-protected-resource/api/mcp`)
  expect(res.status()).toBe(200)
  expect(((await res.json()) as { resource: string }).resource).toBe(`${WEB_ORIGIN}/api/mcp`)
})

test('serves /api/openapi.json through the web origin', async ({ request }) => {
  const doc = await request.get(`${WEB_ORIGIN}/api/openapi.json`)
  expect(doc.status()).toBe(200)
  expect(((await doc.json()) as { openapi: string }).openapi).toMatch(/^3\./)
})

test('forwards POST bodies, leaves redirects to the browser and passes the client address', async ({
  request,
}) => {
  const email = uniqueEmail('proxy')
  const asked = await request.post(`${WEB_ORIGIN}/api/auth/sign-in/magic-link`, {
    headers: { origin: WEB_ORIGIN },
    data: { email, callbackURL: `${WEB_ORIGIN}/profile` },
  })
  expect(asked.status()).toBe(200)

  const link = await magicLinkFor(request, email)
  expect(link.startsWith(WEB_ORIGIN)).toBe(true)

  // The API's redirect reaches the browser as a redirect (the proxy does not follow it).
  const opened = await request.get(link, { maxRedirects: 0 })
  expect(opened.status()).toBeGreaterThanOrEqual(300)
  expect(opened.status()).toBeLessThan(400)
  expect(opened.headers().location).toContain('/profile')
  expect(opened.headers()['set-cookie']).toMatch(/session_token=/)

  // Better Auth records the client address from x-forwarded-for, which the proxy must send.
  const sessions = await request.get(`${WEB_ORIGIN}/api/auth/list-sessions`, {
    headers: { origin: WEB_ORIGIN },
  })
  expect(sessions.status()).toBe(200)
  const [session] = (await sessions.json()) as { ipAddress?: string | null }[]
  expect(session?.ipAddress).toBeTruthy()
})
