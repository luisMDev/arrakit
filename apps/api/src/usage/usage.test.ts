import { ORPCError, call, os } from '@orpc/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { type BaseContext, requireMember, requireSession } from '../orpc/context'
import { type TestApp, createTestApp } from '../testing/app'
import { requiresUsage } from './requires-usage'
import { usageService } from './usage-service'

const report = os
  .$context<BaseContext>()
  .use(requireSession)
  .use(requireMember('member'))
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
  })

describe('usage', () => {
  let t: TestApp
  let organizationId: string
  let owner: Headers
  let member: Headers
  let counter = 0

  async function organizationWithOwner(name: string) {
    counter += 1
    const { headers, userId } = await t.signIn({ email: `owner${counter}@acme.com` })
    const organization = await t.data.createOrganization(name, { userId, termsAccepted: true })
    return { headers, organizationId: organization.id }
  }

  beforeAll(async () => {
    t = await createTestApp()
    ;({ headers: owner, organizationId } = await organizationWithOwner('Acme'))
    const signedIn = await t.signIn({ email: 'mo@acme.com' })
    const { test } = await t.deps.auth.$context
    await test.addMember!({ userId: signedIn.userId, organizationId, role: 'member' })
    member = signedIn.headers
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
    const { headers, organizationId: id } = await organizationWithOwner('Topped')
    await t.data.forOrganization(id).usage.credit(2_500, { idempotencyKey: 'checkout:cs_a' })
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
    const { headers, organizationId: id } = await organizationWithOwner('Disputed')
    const usage = t.data.forOrganization(id).usage
    await usage.credit(1_000, { idempotencyKey: 'checkout:disputed' })
    const payment = { key: 'pi_disputed', cents: 1_000 }
    await usage.reverse(500, { idempotencyKey: 'refund:disputed', payment })
    await usage.reverse(1_000, { idempotencyKey: 'dispute:disputed', payment })
    await usage.adjust('storage_gb', -500, { idempotencyKey: 'clawback:disputed' })
    const view = await t.client(headers).usage.get()
    expect(view.metrics.find((m) => m.metric === 'credits')).toMatchObject({
      purchased: 0,
      available: 100,
    })
    expect(view.metrics.find((m) => m.metric === 'storage_gb')).toMatchObject({
      purchased: -500,
      available: 0,
      limit: 0,
    })
  })

  it('refuses signed-out callers', async () => {
    await expect(t.client().usage.get()).rejects.toMatchObject({ status: 401 })
  })

  it('answers 404 to someone without an organization', async () => {
    const { headers } = await t.signIn({ email: 'loner@acme.com' })
    await expect(t.client(headers).usage.get()).rejects.toMatchObject({ status: 404 })
  })

  it('tells whether a use fits without spending it', async () => {
    const { organizationId: id } = await organizationWithOwner('Checks')
    const usage = usageService(t.data)
    expect(await usage.can(id, 'credits', 100)).toBe(true)
    expect(await usage.can(id, 'credits', 101)).toBe(false)
    await expect(usage.requireAvailable(id, 'credits', 101)).rejects.toMatchObject({
      status: 402,
      data: { metric: 'credits', requested: 101, available: 100 },
    })
    expect((await usage.check(id, 'credits')).available).toBe(100)
  })

  it('guards a procedure with requiresUsage and spends only what the handler consumes', async () => {
    const { headers, organizationId: id } = await organizationWithOwner('Reports')
    const context = { deps: t.deps, data: t.data, headers }
    await expect(call(report, { id: 'a' }, { context })).resolves.toEqual({ left: 60 })
    await expect(call(report, { id: 'a' }, { context })).resolves.toEqual({ left: 60 })
    await expect(call(report, { id: 'b' }, { context })).resolves.toEqual({ left: 20 })

    const error = await call(report, { id: 'c' }, { context }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({
      status: 402,
      code: 'PAYMENT_REQUIRED',
      data: { metric: 'credits', requested: 40, available: 20 },
    })
    expect((error as Error).message).toContain('Add credits in Settings → Billing')
    expect((await t.data.forOrganization(id).usage.check('credits')).available).toBe(20)
  })

  it('maps limit errors on consume and set to 402', async () => {
    const { organizationId: id } = await organizationWithOwner('Limits')
    const usage = usageService(t.data)
    await expect(usage.consume(id, 'credits', 101, 'big')).rejects.toMatchObject({ status: 402 })
    await expect(usage.set(id, 'storage_gb', 10)).resolves.toMatchObject({ used: 10 })
    await expect(usage.set(id, 'storage_gb', 11)).rejects.toMatchObject({
      status: 402,
      data: { metric: 'storage_gb', requested: 1, available: 0 },
    })
  })

  it('rethrows errors that are not limits', async () => {
    const { organizationId: id } = await organizationWithOwner('Broken')
    await expect(usageService(t.data).consume(id, 'storage_gb', 1, 'x')).rejects.toThrow(/capacity/)
  })

  it('refuses requiresUsage without the organization middleware', async () => {
    const bare = os
      .$context<BaseContext>()
      .use(requiresUsage('credits') as never)
      .handler(() => 'ok')
    await expect(
      call(bare, undefined, { context: { deps: t.deps, data: t.data, headers: owner } }),
    ).rejects.toThrow('requiresUsage runs after the organization role middleware')
  })
})
