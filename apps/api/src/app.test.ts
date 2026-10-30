import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { openApiDocument } from './app'
import { type TestApp, createTestApp } from './testing/app'

describe('api app', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  it('answers /health with every probe up', async () => {
    const res = await t.app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', postgres: 'up', storage: 'up', queue: 'up' })
  })

  it('serves the OpenAPI document generated from the contract', async () => {
    const res = await t.app.request('/api/openapi.json')
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> }
    expect(doc.openapi).toMatch(/^3\./)
    expect(doc).toEqual(JSON.parse(JSON.stringify(await openApiDocument())))
    expect(Object.keys(doc.paths)).toContain('/me')
  })

  it('returns 404 for unknown routes', async () => {
    expect((await t.app.request('/nope')).status).toBe(404)
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
    await expect(t.client(headers).members.list()).rejects.toMatchObject({ status: 404 })
  })

  it('mounts Better Auth, the MCP challenge and the Stripe webhook', async () => {
    expect((await t.app.request('/api/auth/get-session')).status).toBe(200)
    const mcp = await t.app.request('/api/mcp', { method: 'POST' })
    expect(mcp.status).toBe(401)
    expect(mcp.headers.get('www-authenticate')).toContain('resource_metadata=')
    expect((await t.app.request('/api/webhooks/stripe', { method: 'POST' })).status).toBe(401)
    const meta = await t.app.request('/.well-known/oauth-authorization-server/api/auth')
    expect(((await meta.json()) as { issuer: string }).issuer).toBe(
      'http://localhost:4200/api/auth',
    )
  })
})
