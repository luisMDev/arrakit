import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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
