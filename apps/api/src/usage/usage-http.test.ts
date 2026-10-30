import type { AddressInfo } from 'node:net'

import { serve } from '@hono/node-server'
import { createORPCClient, ORPCError } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { type RouterClient, os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { type BaseContext, requireMember, requireSession } from '../orpc/context'
import { type TestApp, TEST_WEB_ORIGIN, createTestApp } from '../testing/app'
import { requiresUsage } from './requires-usage'
import { usageService } from './usage-service'

const member = os.$context<BaseContext>().use(requireSession).use(requireMember('member'))

/** Probe procedures standing in for real features that spend usage. */
const probe = {
  report: member
    .route({ method: 'POST', path: '/probe/report' })
    .use(requiresUsage('credits', 40))
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const usage = await usageService(context.data).consume(
        context.activeOrganization.id,
        'credits',
        40,
        `report:${input.id}`,
      )
      return { left: usage.available }
    }),
  spend: member
    .route({ method: 'POST', path: '/probe/spend' })
    .input(z.object({ quantity: z.number().int(), key: z.string() }))
    .handler(async ({ context, input }) => {
      const usage = await usageService(context.data).consume(
        context.activeOrganization.id,
        'credits',
        input.quantity,
        input.key,
      )
      return { left: usage.available }
    }),
  storage: member
    .route({ method: 'PUT', path: '/probe/storage' })
    .input(z.object({ gb: z.number().int() }))
    .handler(async ({ context, input }) => {
      const usage = await usageService(context.data).set(
        context.activeOrganization.id,
        'storage_gb',
        input.gb,
      )
      return { used: usage.used }
    }),
}

/** The test app plus the probe, mounted the way app.ts mounts the real router. */
function probeServer(t: TestApp) {
  const rpc = new RPCHandler(probe)
  const openapi = new OpenAPIHandler(probe)
  const server = new Hono()
  server.use('/api/probe-rpc/*', async (c, next) => {
    const { matched, response } = await rpc.handle(c.req.raw, {
      prefix: '/api/probe-rpc',
      context: t.context(c.req.raw.headers),
    })
    if (matched) return c.newResponse(response.body, response)
    await next()
  })
  server.use('/api/probe/*', async (c, next) => {
    const { matched, response } = await openapi.handle(c.req.raw, {
      prefix: '/api',
      context: t.context(c.req.raw.headers),
    })
    if (matched) return c.newResponse(response.body, response)
    await next()
  })
  server.route('/', t.app)
  return server
}

interface PaymentRequiredBody {
  code: string
  status: number
  message: string
  data: { metric: string; requested: number; available: number }
}

describe('usage over HTTP', () => {
  let t: TestApp
  let close: () => Promise<void>
  let baseUrl: string
  let counter = 0

  async function owner(name: string) {
    counter += 1
    const { headers, userId } = await t.signIn({ email: `wire${counter}@acme.com` })
    await t.data.createOrganization(name, { userId, termsAccepted: true })
    return headers
  }

  const call = (headers: Headers, method: string, path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        cookie: headers.get('cookie') ?? '',
        origin: TEST_WEB_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

  const rpcClient = (headers: Headers): RouterClient<typeof probe> =>
    createORPCClient(
      new RPCLink({
        url: `${baseUrl}/api/probe-rpc`,
        headers: () => ({ cookie: headers.get('cookie') ?? '', origin: TEST_WEB_ORIGIN }),
      }),
    )

  beforeAll(async () => {
    t = await createTestApp()
    const app = probeServer(t)
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => new Promise((resolve) => server.close(() => resolve()))
  })
  afterAll(async () => {
    await close()
    await t.close()
  })

  it('answers 402 with metric, requested, available and the Add credits message once requiresUsage fails', async () => {
    const headers = await owner('Wire reports')
    expect(await (await call(headers, 'POST', '/api/probe/report', { id: 'a' })).json()).toEqual({
      left: 60,
    })
    expect(await (await call(headers, 'POST', '/api/probe/report', { id: 'b' })).json()).toEqual({
      left: 20,
    })

    const res = await call(headers, 'POST', '/api/probe/report', { id: 'c' })
    expect(res.status).toBe(402)
    const body = (await res.json()) as PaymentRequiredBody
    expect(body).toMatchObject({
      code: 'PAYMENT_REQUIRED',
      status: 402,
      data: { metric: 'credits', requested: 40, available: 20 },
    })
    expect(body.message).toContain('Add credits in Settings → Billing')
  })

  it('answers 402 when a consume goes past what is left, spending nothing', async () => {
    const headers = await owner('Wire spend')
    const res = await call(headers, 'POST', '/api/probe/spend', { quantity: 101, key: 'big' })
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({
      code: 'PAYMENT_REQUIRED',
      data: { metric: 'credits', requested: 101, available: 100 },
    })
    const fits = await call(headers, 'POST', '/api/probe/spend', { quantity: 100, key: 'all' })
    expect(fits.status).toBe(200)
    expect(await fits.json()).toEqual({ left: 0 })
  })

  it('lets storage be set to its limit and answers 402 one unit past it', async () => {
    const headers = await owner('Wire storage')
    const ok = await call(headers, 'PUT', '/api/probe/storage', { gb: 10 })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ used: 10 })

    const over = await call(headers, 'PUT', '/api/probe/storage', { gb: 11 })
    expect(over.status).toBe(402)
    const body = (await over.json()) as PaymentRequiredBody
    expect(body.data).toEqual({ metric: 'storage_gb', requested: 1, available: 0 })
    expect(body.message).toContain('Add credits in Settings → Billing')
  })

  it('hands the RPC client a typed 402 error carrying the usage data', async () => {
    const headers = await owner('Wire rpc')
    const client = rpcClient(headers)
    await expect(client.report({ id: 'a' })).resolves.toEqual({ left: 60 })
    await expect(client.report({ id: 'b' })).resolves.toEqual({ left: 20 })

    const error = await client.report({ id: 'c' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({
      status: 402,
      code: 'PAYMENT_REQUIRED',
      data: { metric: 'credits', requested: 40, available: 20 },
    })
    expect((error as Error).message).toContain('Add credits in Settings → Billing')
  })

  it('still answers 401 before checking usage for signed-out callers', async () => {
    const res = await fetch(`${baseUrl}/api/probe/report`, {
      method: 'POST',
      headers: { origin: TEST_WEB_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'x' }),
    })
    expect(res.status).toBe(401)
  })

  it('keeps serving the real app next to the probe', async () => {
    const headers = await owner('Wire real')
    const res = await fetch(`${baseUrl}/api/rpc/usage/get`, {
      method: 'POST',
      headers: { cookie: headers.get('cookie') ?? '', origin: TEST_WEB_ORIGIN },
    })
    expect(res.status).toBe(200)
  })
})
