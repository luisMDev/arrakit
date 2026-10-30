import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { ORPCError, type RouterClient, call, os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { type BaseContext, reportErrors, requireMember, requireSession } from '../orpc/context'
import { TEST_WEB_ORIGIN, type TestApp, createTestApp } from '../testing/app'
import { joinAs, ownerOf } from '../testing/people'
import { requiresUsage } from './requires-usage'

const member = os.$context<BaseContext>().use(reportErrors).use(requireSession).use(requireMember())

/** Probe procedures standing in for real features that spend usage. */
const probe = {
  report: member
    .use(requiresUsage('credits', 40))
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const usage = await context.scope.usage.consume('credits', 40, {
        idempotencyKey: `report:${input.id}`,
      })
      return { left: usage.available }
    }),
  spend: member
    .input(z.object({ quantity: z.number().int(), key: z.string() }))
    .handler(async ({ context, input }) => {
      const usage = await context.scope.usage.consume('credits', input.quantity, {
        idempotencyKey: input.key,
      })
      return { left: usage.available }
    }),
  storage: member.input(z.object({ gb: z.number().int() })).handler(async ({ context, input }) => {
    const usage = await context.scope.usage.set('storage_gb', input.gb)
    return { used: usage.used }
  }),
}

describe('usage', () => {
  let t: TestApp
  let member: Headers
  let counter = 0

  const owner = async () => {
    counter += 1
    return ownerOf(t, `owner${counter}@acme.com`, 'free')
  }

  const probeClient = (headers: Headers): RouterClient<typeof probe> => {
    const rpc = new RPCHandler(probe)
    return createORPCClient(
      new RPCLink({
        url: `${TEST_WEB_ORIGIN}/probe`,
        headers: () => Object.fromEntries(headers.entries()),
        fetch: async (request) => {
          const { response } = await rpc.handle(request as Request, {
            prefix: '/probe',
            context: t.context((request as Request).headers),
          })
          return response ?? new Response(null, { status: 404 })
        },
      }),
    )
  }

  beforeAll(async () => {
    t = await createTestApp()
    const { organizationId } = await owner()
    ;({ headers: member } = await joinAs(t, organizationId, 'mo@acme.com', 'member'))
  })
  afterAll(() => t.close())

  it('shows a fresh Free organization its month to any member', async () => {
    const view = await t.client(member).usage.get()
    expect(view.currency).toBe('usd')
    expect(view.topUps).toEqual([])
    expect(view.metrics).toEqual([
      {
        metric: 'credits',
        kind: 'consumable',
        granted: 100,
        plan: 100,
        purchased: 0,
        used: 0,
        available: 100,
        limit: null,
        resetsOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      },
      {
        metric: 'storage_gb',
        kind: 'capacity',
        granted: 10,
        plan: 10,
        purchased: 0,
        used: 0,
        available: 10,
        limit: 10,
        resetsOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      },
    ])
  })

  it('lists top-ups newest first with their amounts', async () => {
    const { headers, organizationId } = await owner()
    await t.data
      .forOrganization(organizationId)
      .usage.credit(2_500, { idempotencyKey: 'checkout:cs_a' })
    const view = await t.client(headers).usage.get()
    expect(view.topUps).toEqual([
      {
        paidOn: new Date().toISOString().slice(0, 10),
        cents: 2_500,
        amounts: [
          { metric: 'credits', amount: 2_500 },
          { metric: 'storage_gb', amount: 250 },
        ],
      },
    ])
  })

  it('keeps showing usage after refunds and disputes take back more than a top-up bought', async () => {
    const { headers, organizationId } = await owner()
    const usage = t.data.forOrganization(organizationId).usage
    await usage.credit(1_000, { idempotencyKey: 'checkout:disputed' })
    const payment = { key: 'pi_disputed', cents: 1_000 }
    await usage.reverse(500, { idempotencyKey: 'refund:disputed', payment })
    await usage.reverse(1_000, { idempotencyKey: 'dispute:disputed', payment })
    const view = await t.client(headers).usage.get()
    expect(view.metrics.find((m) => m.metric === 'credits')).toMatchObject({
      purchased: 0,
      available: 100,
    })
  })

  it('refuses signed-out callers', async () => {
    await expect(t.client().usage.get()).rejects.toMatchObject({ status: 401 })
  })

  it('answers 404 to someone without an organization', async () => {
    const { headers } = await t.signIn({ email: 'loner@acme.com' })
    await expect(t.client(headers).usage.get()).rejects.toMatchObject({ status: 404 })
  })

  it('guards a procedure with requiresUsage and spends only what the handler consumes', async () => {
    const { headers, organizationId } = await owner()
    const context = t.context(headers)
    await expect(call(probe.report, { id: 'a' }, { context })).resolves.toEqual({ left: 60 })
    await expect(call(probe.report, { id: 'a' }, { context })).resolves.toEqual({ left: 60 })
    await expect(call(probe.report, { id: 'b' }, { context })).resolves.toEqual({ left: 20 })

    const error = await call(probe.report, { id: 'c' }, { context }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({
      status: 402,
      code: 'PAYMENT_REQUIRED',
      data: { metric: 'credits', requested: 40, available: 20 },
    })
    expect((error as Error).message).toContain('Add credits in Settings → Billing')
    expect((await t.data.forOrganization(organizationId).usage.check('credits')).available).toBe(20)
  })

  it('answers 402 when a consume goes past what is left, spending nothing', async () => {
    const { headers } = await owner()
    const context = t.context(headers)
    await expect(
      call(probe.spend, { quantity: 101, key: 'big' }, { context }),
    ).rejects.toMatchObject({
      status: 402,
      data: { metric: 'credits', requested: 101, available: 100 },
    })
    await expect(call(probe.spend, { quantity: 100, key: 'all' }, { context })).resolves.toEqual({
      left: 0,
    })
  })

  it('lets storage be set to its limit and answers 402 one unit past it', async () => {
    const { headers } = await owner()
    const context = t.context(headers)
    await expect(call(probe.storage, { gb: 10 }, { context })).resolves.toEqual({ used: 10 })
    await expect(call(probe.storage, { gb: 11 }, { context })).rejects.toMatchObject({
      status: 402,
      data: { metric: 'storage_gb', requested: 1, available: 0 },
    })
  })

  it('hands the RPC client a 402 error carrying the usage data', async () => {
    const { headers } = await owner()
    const client = probeClient(headers)
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

  it('answers 401 before checking usage for signed-out callers', async () => {
    await expect(probeClient(new Headers()).report({ id: 'x' })).rejects.toMatchObject({
      status: 401,
    })
  })
})
