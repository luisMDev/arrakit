import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { type TestApp, createTestApp } from './testing/app'

describe('api app', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  it('answers /health with every probe up', async () => {
    const res = await t.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', postgres: 'up', storage: 'up', queue: 'up' })
  })

  it('answers /health 503 with the same shape when a probe is down', async () => {
    const down = { status: 'error', postgres: 'up', storage: 'down', queue: 'up' } as const
    vi.spyOn(t.data, 'health').mockResolvedValueOnce(down)
    const res = await t.request('/health')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual(down)
  })

  it('serves /health as the only route outside /api', async () => {
    expect((await t.request('/api/health')).status).toBe(404)
    expect((await t.request('/healthz')).status).toBe(404)
  })

  it('returns 404 for unknown routes, and serves no REST or OpenAPI', async () => {
    expect((await t.app.request('/nope')).status).toBe(404)
    expect((await t.app.request('/api/openapi.json')).status).toBe(404)
    expect((await t.app.request('/api/me')).status).toBe(404)
  })

  it('refuses a procedure call that does not come from the app', async () => {
    const { headers } = await t.signIn({ email: 'csrf@acme.com' })
    for (const origin of [null, 'null', 'https://evil.example']) {
      const sent = new Headers(headers)
      if (origin === null) sent.delete('origin')
      else sent.set('origin', origin)
      const res = await t.request('/api/rpc/me/get', { method: 'POST', headers: sent })
      expect(res.status).toBe(403)
    }
    const evil = new Headers(headers)
    evil.set('origin', 'https://evil.example')
    await expect(t.client(evil).me.get()).rejects.toMatchObject({
      status: 403,
      message: 'Use the app.',
    })
  })

  it('answers public procedures and refuses signed-out callers', async () => {
    await expect(t.client().authProviders.get()).resolves.toEqual({
      google: false,
      microsoft: false,
    })
    await expect(t.client().me.get()).rejects.toMatchObject({ status: 401 })
  })

  it('signs people in with Better Auth testUtils and reads me.get', async () => {
    const { headers } = await t.signIn({ email: 'ana@acme.com' })
    await expect(t.client(headers).me.get()).resolves.toMatchObject({
      email: 'ana@acme.com',
      organization: null,
      role: null,
    })
    await expect(t.client(headers).usage.get()).rejects.toMatchObject({ status: 404 })
  })

  it('mounts Better Auth, the MCP challenge and the Stripe webhook', async () => {
    expect((await t.app.request('/api/auth/get-session')).status).toBe(200)
    const mcp = await t.app.request('/api/mcp', { method: 'POST' })
    expect(mcp.status).toBe(401)
    expect(mcp.headers.get('www-authenticate')).toContain('resource_metadata=')
    expect((await t.app.request('/api/webhooks/stripe', { method: 'POST' })).status).toBe(401)
    const meta = await t.app.request('/.well-known/oauth-authorization-server/api/auth')
    expect(((await meta.json()) as { issuer: string }).issuer).toBe(
      'http://localhost:5200/api/auth',
    )
  })
})
