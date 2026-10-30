import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { openApiDocument } from '../app'
import { type TestApp, createTestApp } from '../testing/app'

describe('GET /health', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  it('answers 200 when every probe is up', async () => {
    const res = await t.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', postgres: 'up', storage: 'up', queue: 'up' })
  })

  it('answers 503 with the same shape when a probe is down', async () => {
    vi.spyOn(t.data, 'health').mockResolvedValueOnce({
      status: 'error',
      postgres: 'up',
      storage: 'down',
      queue: 'up',
    })
    const res = await t.request('/health')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      status: 'error',
      postgres: 'up',
      storage: 'down',
      queue: 'up',
    })
  })

  it('is the only route outside /api', async () => {
    expect((await t.request('/api/health')).status).toBe(404)
    expect((await t.request('/healthz')).status).toBe(404)
  })
})

describe('the OpenAPI document', () => {
  it('is generated from the contract alone, with every path under /api', async () => {
    const doc = (await openApiDocument()) as {
      servers?: { url: string }[]
      paths: Record<string, unknown>
    }
    expect(doc.servers?.[0]?.url).toBe('/api')
    expect(Object.keys(doc.paths).length).toBeGreaterThan(0)
  })

  it('serves /health from the root, not from the /api server', async () => {
    const doc = (await openApiDocument()) as unknown as {
      paths: Record<string, { get: { servers?: { url: string }[] } }>
    }
    expect(doc.paths['/health']!.get.servers).toEqual([{ url: '/' }])
  })

  it('lists the health check under the health tag', async () => {
    const doc = (await openApiDocument()) as unknown as {
      paths: Record<string, Record<string, { tags?: string[]; responses: Record<string, unknown> }>>
    }
    const entry = Object.entries(doc.paths).find(([path]) => path.endsWith('/health'))
    expect(entry).toBeDefined()
    const operation = Object.values(entry![1])[0]!
    expect(operation.tags).toContain('health')
  })

  it('documents 200 and 503 with the same body', async () => {
    const doc = (await openApiDocument()) as unknown as {
      paths: Record<string, { get: { responses: Record<string, { content?: unknown }> } }>
    }
    const { responses } = doc.paths['/health']!.get
    expect(responses['503']?.content).toEqual(responses['200']?.content)
  })
})

const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const

describe('the operations the OpenAPI document lists', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  /** Every documented operation as [METHOD, URL path the client calls]. */
  const operations = async () => {
    const doc = (await openApiDocument()) as unknown as {
      servers: { url: string }[]
      paths: Record<string, Record<string, { servers?: { url: string }[] }>>
    }
    return Object.entries(doc.paths).flatMap(([path, item]) =>
      METHODS.filter((method) => item[method]).map((method) => {
        const server = (item[method]!.servers ?? doc.servers)[0]!.url.replace(/\/$/, '')
        const concrete = path.replace(/\{[^}]+\}/g, 'x')
        return [method.toUpperCase(), `${server}${concrete}`] as const
      }),
    )
  }

  it('are all served at the URL the document gives (no route-level 404)', async () => {
    const ops = await operations()
    expect(ops.length).toBeGreaterThan(10)
    for (const [method, url] of ops) {
      const res = await t.request(url, {
        method,
        ...(method === 'GET'
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: '{}' }),
      })
      const body = (await res.json().catch(() => null)) as { message?: string } | null
      // The app's catch-all 404 is `{ message: 'Not Found' }`; a procedure's own 404 carries a code.
      expect({
        method,
        url,
        unrouted: res.status === 404 && body?.message === 'Not Found',
      }).toEqual({ method, url, unrouted: false })
    }
  })

  it('answers a public operation REST-style', async () => {
    const res = await t.request('/api/auth-providers')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ google: false, microsoft: false })
  })

  it('answers a signed-in operation REST-style and refuses signed-out callers', async () => {
    expect((await t.request('/api/me')).status).toBe(401)
    const { headers } = await t.signIn({ email: 'rest@acme.com' })
    const res = await t.request('/api/me', { headers })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ email: 'rest@acme.com' })
  })

  it('leaves the RPC, auth and webhook routes to their own handlers', async () => {
    expect((await t.request('/api/auth/get-session')).status).toBe(200)
    expect((await t.request('/api/webhooks/stripe', { method: 'POST' })).status).toBe(401)
    expect((await t.request('/api/nope')).status).toBe(404)
  })
})
