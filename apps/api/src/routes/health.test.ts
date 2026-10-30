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
