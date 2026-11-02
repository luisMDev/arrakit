import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { isCrossOriginPath } from './security-headers'
import { type TestApp, createTestApp } from './testing/app'

const BASELINE = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  'cross-origin-opener-policy': 'same-origin',
}

function expectBaseline(res: Response, resourcePolicy: 'same-origin' | 'cross-origin') {
  for (const [name, value] of Object.entries(BASELINE)) {
    expect(res.headers.get(name), name).toBe(value)
  }
  expect(res.headers.get('cross-origin-resource-policy')).toBe(resourcePolicy)
  expect(res.headers.get('cross-origin-embedder-policy')).toBeNull()
  expect(res.headers.get('x-powered-by')).toBeNull()
}

describe('security headers', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  it('sets the baseline on /health', async () => {
    expectBaseline(await t.request('/health'), 'same-origin')
  })

  it('sets the baseline on procedure answers and refusals', async () => {
    const { headers } = await t.signIn({ email: 'headers@acme.com' })
    const ok = await t.request('/api/rpc/me/get', { method: 'POST', headers })
    expect(ok.status).toBe(200)
    expectBaseline(ok, 'same-origin')

    const evil = new Headers(headers)
    evil.set('origin', 'https://evil.example')
    const refused = await t.request('/api/rpc/me/get', { method: 'POST', headers: evil })
    expect(refused.status).toBe(403)
    expectBaseline(refused, 'same-origin')
  })

  it('sets the baseline on Better Auth, the Stripe webhook and unknown routes', async () => {
    expectBaseline(await t.request('/api/auth/get-session'), 'same-origin')
    expectBaseline(await t.request('/api/webhooks/stripe', { method: 'POST' }), 'same-origin')
    expectBaseline(await t.request('/nope'), 'same-origin')
  })

  it('lets other origins read the OAuth metadata and the MCP endpoint', async () => {
    const origin = { origin: 'https://mcp-client.example' }
    const server = await t.request('/.well-known/oauth-authorization-server/api/auth', {
      headers: origin,
    })
    expect(server.status).toBe(200)
    expectBaseline(server, 'cross-origin')
    const metadata = (await server.json()) as Record<string, unknown>
    const endpoints = Object.entries(metadata).filter(
      ([key, value]) => /(_endpoint|_uri)$/.test(key) && typeof value === 'string',
    )
    expect(endpoints.length).toBeGreaterThan(2)
    for (const [key, url] of endpoints) {
      expect(isCrossOriginPath(new URL(url as string).pathname), key).toBe(true)
    }

    const resource = await t.request('/.well-known/oauth-protected-resource/api/mcp', {
      headers: origin,
    })
    expect(resource.status).toBe(200)
    expectBaseline(resource, 'cross-origin')

    const mcp = await t.request('/api/mcp', { method: 'POST', headers: origin })
    expect(mcp.status).toBe(401)
    expect(mcp.headers.get('www-authenticate')).toContain('resource_metadata=')
    expectBaseline(mcp, 'cross-origin')
  })

  it('marks only the OAuth and MCP paths as readable cross-origin', () => {
    for (const path of [
      '/.well-known/oauth-authorization-server/api/auth',
      '/.well-known/oauth-protected-resource/api/mcp',
      '/api/mcp',
      '/api/auth/oauth2/token',
      '/api/auth/oauth2/register',
      '/api/auth/jwks',
    ]) {
      expect(isCrossOriginPath(path), path).toBe(true)
    }
    for (const path of ['/health', '/api/rpc/me/get', '/api/auth/get-session', '/api/mcpx']) {
      expect(isCrossOriginPath(path), path).toBe(false)
    }
  })
})
