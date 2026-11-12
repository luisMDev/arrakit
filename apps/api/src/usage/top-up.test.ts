import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { type TestApp, TEST_WEB_ORIGIN, createTestApp } from '../testing/app'
import { type FakeStripe, fakeStripe } from '../billing/fake-stripe'
import { joinAs, ownerOf } from '../testing/people'

describe('top-ups', () => {
  let t: TestApp
  let stripe: FakeStripe
  let owner: Headers
  let member: Headers
  let organizationId: string

  beforeAll(async () => {
    stripe = fakeStripe()
    t = await createTestApp({ stripe })
    ;({ headers: owner, organizationId } = await ownerOf(t, 'ana@acme.com', 'free'))
    ;({ headers: member } = await joinAs(t, organizationId, 'mo@acme.com', 'member'))
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    await t.close()
  })

  const purchased = async (id = organizationId) =>
    Object.fromEntries(
      (await t.data.asSystem(id).usage.summary()).map((m) => [m.metric, m.purchased]),
    )

  describe('billing.topUp', () => {
    it('opens a Stripe Checkout for an admin', async () => {
      const { url } = await t.client(owner).billing.topUp({ cents: 2_000 })
      expect(url).toMatch(/^https:\/\/checkout\.stripe\.test/)
      expect(stripe.topUps.at(-1)).toEqual({
        organizationId,
        cents: 2_000,
        customerId: null,
        email: 'ana@acme.com',
        successUrl: `${TEST_WEB_ORIGIN}/app/billing?top_up=paid`,
        cancelUrl: `${TEST_WEB_ORIGIN}/app/billing`,
      })
    })

    it.each([999, 50_001, 1_000.5, '2000'])('refuses %s cents with 400', async (cents) => {
      await expect(t.client(owner).billing.topUp({ cents: cents as number })).rejects.toMatchObject(
        { status: 400 },
      )
    })

    it('refuses a request from another origin', async () => {
      const headers = new Headers(owner)
      headers.set('origin', 'https://evil.example')
      await expect(t.client(headers).billing.topUp({ cents: 2_000 })).rejects.toMatchObject({
        status: 403,
        message: 'Use the app.',
      })
    })

    it('refuses a plain member', async () => {
      await expect(t.client(member).billing.topUp({ cents: 2_000 })).rejects.toMatchObject({
        status: 403,
      })
    })

    it('answers 502 when Stripe fails', async () => {
      stripe.failNext('topUpCheckout', new Error('stripe is down'))
      await expect(t.client(owner).billing.topUp({ cents: 2_000 })).rejects.toMatchObject({
        status: 502,
        message: "Couldn't reach Stripe. Try again in a minute.",
      })
    })

    it('answers 503 without Stripe', async () => {
      const bare = await createTestApp()
      try {
        const { headers } = await ownerOf(bare, 'zoe@zed.io', 'free')
        await expect(bare.client(headers).billing.topUp({ cents: 2_000 })).rejects.toMatchObject({
          status: 503,
          message: 'Payments are not set up yet.',
        })
      } finally {
        await bare.close()
      }
    })
  })

  describe('webhook settlement', () => {
    const paid = (sessionId: string, overrides: Record<string, unknown> = {}) => ({
      kind: 'top-up',
      sessionId,
      organizationId,
      customerId: null,
      cents: 2_000,
      paid: true,
      ...overrides,
    })
    const reversal = (reversalId: string, paymentIntentId: string, amount: number) => ({
      kind: 'payment-reversed',
      reversalId,
      paymentIntentId,
      amount,
    })
    const newOrganization = async (email: string) =>
      (await ownerOf(t, email, 'free')).organizationId

    it('credits a paid top-up once per Checkout session, completed or async', async () => {
      const before = await purchased()
      expect((await t.webhook(paid('cs_once'))).status).toBe(204)
      expect((await t.webhook(paid('cs_once'))).status).toBe(204)
      const after = await purchased()
      expect(after.credits! - before.credits!).toBe(2_000)
      expect(after.storage_gb! - before.storage_gb!).toBe(200)
    })

    it('shows the credited top-up in usage.get', async () => {
      const { headers, organizationId: id } = await ownerOf(t, 'una@usage.io', 'free')
      await t.webhook(paid('cs_view', { organizationId: id, cents: 2_550 }))
      const usage = await t.client(headers).usage.get()
      expect(usage.topUps).toEqual([
        {
          paidOn: new Date().toISOString().slice(0, 10),
          cents: 2_550,
          amounts: [
            { metric: 'credits', amount: 2_550 },
            { metric: 'storage_gb', amount: 255 },
          ],
        },
      ])
      expect(usage.metrics.find((m) => m.metric === 'credits')).toMatchObject({
        plan: 100,
        purchased: 2_550,
        available: 2_650,
      })
    })

    it('keeps the first Stripe customer without changing the plan', async () => {
      const id = await newOrganization('cy@customer.io')
      await t.webhook(paid('cs_c1', { organizationId: id, customerId: 'cus_first' }))
      await t.webhook(paid('cs_c2', { organizationId: id, customerId: 'cus_second' }))
      const organization = await t.data.asSystem(id).organization()
      expect(organization).toMatchObject({ stripeCustomerId: 'cus_first', plan: 'free' })
      expect((await purchased(id)).credits).toBe(4_000)
    })

    it('credits nothing while the payment is pending, then credits when it succeeds', async () => {
      const id = await newOrganization('pat@pending.io')
      expect(
        (await t.webhook(paid('cs_pending', { organizationId: id, paid: false }))).status,
      ).toBe(204)
      expect(await purchased(id)).toEqual({ credits: 0, storage_gb: 0 })
      await t.webhook(paid('cs_pending', { organizationId: id }))
      expect(await purchased(id)).toEqual({ credits: 2_000, storage_gb: 200 })
    })

    it('answers 204 to a top-up naming no, a malformed or a deleted organization', async () => {
      const before = await purchased()
      for (const organizationId of [null, 'nope', '0f8fad5b-d9cb-469f-a165-70867728950e']) {
        expect((await t.webhook(paid(`cs_${organizationId}`, { organizationId }))).status).toBe(204)
      }
      expect(await purchased()).toEqual(before)
    })

    it('reverses a refund proportionally, tax apart, once', async () => {
      const id = await newOrganization('rae@refund.io')
      await t.webhook(paid('cs_refund', { organizationId: id }))
      stripe.topUpPayments.set('pi_1', { organizationId: id, cents: 2_000, total: 2_420 })
      expect((await t.webhook(reversal('re_1', 'pi_1', 1_210))).status).toBe(204)
      expect((await t.webhook(reversal('re_1', 'pi_1', 1_210))).status).toBe(204)
      expect(await purchased(id)).toEqual({ credits: 1_000, storage_gb: 100 })
      const [topUp] = await t.data.asSystem(id).usage.topUps()
      expect(topUp).toMatchObject({ cents: 2_000, amounts: { credits: 2_000, storage_gb: 200 } })
    })

    it('never takes back more than the top-up, even for a dispute of the whole charge', async () => {
      const id = await newOrganization('dee@dispute.io')
      await t.webhook(paid('cs_dispute', { organizationId: id }))
      await t.data.asSystem(id).usage.consume('credits', 1_500, { idempotencyKey: 'job-1' })
      stripe.topUpPayments.set('pi_2', { organizationId: id, cents: 2_000, total: 2_420 })
      await t.webhook(reversal('du_1', 'pi_2', 5_000))
      const credits = (await t.data.asSystem(id).usage.summary())[0]!
      expect(credits).toMatchObject({ plan: 0, purchased: 0, available: 0 })
      await t.webhook(paid('cs_after', { organizationId: id, cents: 1_000 }))
      expect((await t.data.asSystem(id).usage.summary())[0]).toMatchObject({
        purchased: 0,
        available: 0,
      })
    })

    it('caps a refund followed by a dispute of the same payment at the top-up', async () => {
      const id = await newOrganization('ria@refund-dispute.io')
      await t.webhook(paid('cs_split', { organizationId: id }))
      await t.webhook(paid('cs_other', { organizationId: id }))
      stripe.topUpPayments.set('pi_split', { organizationId: id, cents: 2_000, total: 2_420 })
      await t.webhook(reversal('re_split', 'pi_split', 1_210))
      expect(await purchased(id)).toEqual({ credits: 3_000, storage_gb: 300 })
      await t.webhook(reversal('du_split', 'pi_split', 2_420))
      expect(await purchased(id)).toEqual({ credits: 2_000, storage_gb: 200 })
    })

    it('ignores the reversal of a payment that is not a top-up', async () => {
      const before = await purchased()
      expect((await t.webhook(reversal('re_2', 'pi_plan', 2_000))).status).toBe(204)
      expect(await purchased()).toEqual(before)
    })

    it('answers 500 when the payment cannot be read, so Stripe delivers again', async () => {
      stripe.failNext('topUpPayment', new Error('stripe is down'))
      expect((await t.webhook(reversal('re_3', 'pi_1', 100))).status).toBe(500)
    })
  })
})
