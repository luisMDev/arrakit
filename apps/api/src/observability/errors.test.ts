import { ORPCError, call } from '@orpc/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { pub } from '../orpc/base'
import { TEST_WEB_ORIGIN, type TestApp, createTestApp } from '../testing/app'
import { createErrorReporter, isUnexpected, noErrorReporter } from './error-reporter'

describe('request log and unexpected errors', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
    t.app.get('/boom', () => {
      throw new Error('kaboom')
    })
  })
  beforeEach(() => {
    t.logs.splice(0)
    t.captured.splice(0)
  })
  afterEach(() => vi.restoreAllMocks())
  afterAll(() => t.close())

  const failSessions = () =>
    vi.spyOn(t.deps.auth.api, 'getSession').mockRejectedValue(new Error('adapter down'))

  it('gives each request an id, echoes it and logs one access line with it', async () => {
    const res = await t.request('/api/rpc/authProviders/get', {
      method: 'POST',
      headers: { origin: TEST_WEB_ORIGIN },
    })
    const requestId = res.headers.get('x-request-id')
    expect(requestId).toBeTruthy()
    expect(t.logs).toContainEqual(
      expect.objectContaining({
        level: 'info',
        msg: 'request',
        requestId,
        method: 'POST',
        path: '/api/rpc/authProviders/get',
        status: 200,
        ms: expect.any(Number),
      }),
    )
  })

  it('keeps an incoming X-Request-Id, and leaves /health out of the access log', async () => {
    const res = await t.request('/api/rpc/authProviders/get', {
      method: 'POST',
      headers: { 'x-request-id': 'lb-1234', origin: TEST_WEB_ORIGIN },
    })
    expect(res.headers.get('x-request-id')).toBe('lb-1234')
    expect(t.logs).toContainEqual(expect.objectContaining({ requestId: 'lb-1234' }))
    await t.request('/health')
    expect(t.logs.filter((entry) => entry.path === '/health')).toEqual([])
  })

  it('answers a throwing route 500 without its message, logs it and reports it', async () => {
    const res = await t.request('/boom', { headers: { 'x-request-id': 'req-boom' } })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ message: 'Internal Server Error' })
    expect(t.logs).toContainEqual(
      expect.objectContaining({
        level: 'error',
        msg: 'unexpected error',
        requestId: 'req-boom',
        path: '/boom',
        err: expect.objectContaining({ message: 'kaboom' }),
      }),
    )
    expect(t.logs).toContainEqual(
      expect.objectContaining({ level: 'warn', msg: 'request failed', status: 500 }),
    )
    expect(t.captured).toHaveLength(1)
    expect(t.captured[0]).toMatchObject({
      error: expect.objectContaining({ message: 'kaboom' }),
      tags: { method: 'GET', path: '/boom', requestId: 'req-boom' },
    })
  })

  it('reports a procedure that fails unexpectedly, without its message', async () => {
    const { headers } = await t.signIn({ email: 'ana@acme.com' })
    failSessions()
    headers.set('x-request-id', 'req-rpc')
    const res = await t.request('/api/rpc/me/get', { method: 'POST', headers })
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('adapter down')

    expect(t.captured.map((c) => c.tags.procedure)).toEqual(['me.get'])
    expect(t.captured[0]?.tags.requestId).toBe('req-rpc')
    expect(t.logs).toContainEqual(
      expect.objectContaining({
        level: 'error',
        procedure: 'me.get',
        requestId: 'req-rpc',
        err: expect.objectContaining({ message: 'adapter down' }),
      }),
    )
  })

  it('reports a procedure answering what its contract does not allow', async () => {
    const broken = pub.authProviders.get.handler(() => ({ google: 'yes' }) as never)
    await expect(call(broken, undefined, { context: t.context() })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    })
    expect(t.captured).toHaveLength(1)
  })

  it('does not report refusals', async () => {
    await expect(t.client().me.get()).rejects.toMatchObject({ status: 401 })
    expect((await t.request('/nope')).status).toBe(404)
    expect(t.captured).toEqual([])
    expect(t.logs.filter((entry) => entry.level === 'error')).toEqual([])
  })
})

describe('isUnexpected', () => {
  it('is true for plain errors and oRPC 500s, false for deliberate refusals', () => {
    expect(isUnexpected(new Error('bug'))).toBe(true)
    expect(isUnexpected('thrown string')).toBe(true)
    expect(isUnexpected(new ORPCError('INTERNAL_SERVER_ERROR'))).toBe(true)
    expect(isUnexpected(new ORPCError('UNAUTHORIZED'))).toBe(false)
    expect(isUnexpected(new ORPCError('BAD_GATEWAY'))).toBe(false)
    expect(isUnexpected(new ORPCError('SERVICE_UNAVAILABLE'))).toBe(false)
  })
})

describe('createErrorReporter', () => {
  it('reports nowhere without SENTRY_DSN', () => {
    expect(createErrorReporter({ NODE_ENV: 'production' })).toBe(noErrorReporter)
  })
})
