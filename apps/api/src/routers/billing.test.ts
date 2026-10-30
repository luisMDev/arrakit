import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { RENEWAL, joinAs, owner, paying, proYearly } from '../billing/testing'
import { TEST_WEB_ORIGIN, type TestApp, createTestApp } from '../testing/app'
import { FAKE_PRORATION, type FakeStripe, fakeStripe } from '../testing/fake-stripe'

const foreign = (headers: Headers) => {
  const copy = new Headers(headers)
  copy.set('origin', 'https://evil.example')
  return copy
}

const declined = () =>
  Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', statusCode: 402 })

describe('billing procedures', () => {
  let t: TestApp
  let stripe: FakeStripe

  beforeAll(async () => {
    stripe = fakeStripe()
    t = await createTestApp({ stripe })
  })
  afterAll(() => t.close())
  afterEach(() => vi.restoreAllMocks())

  describe('plans.list', () => {
    it('lists the sold plans cheapest first, without Internal, to anyone', async () => {
      await expect(t.client().plans.list()).resolves.toEqual([
        {
          plan: 'free',
          monthly: { amount: 0, currency: 'usd' },
          yearly: { amount: 0, currency: 'usd' },
          seats: 1,
        },
        {
          plan: 'pro',
          monthly: { amount: 2_000, currency: 'usd' },
          yearly: { amount: 19_200, currency: 'usd' },
          seats: 3,
        },
        {
          plan: 'team',
          monthly: { amount: 5_000, currency: 'usd' },
          yearly: { amount: 48_000, currency: 'usd' },
          seats: 10,
        },
      ])
    })
  })

  describe('checkout', () => {
    it('opens Embedded Checkout for the owner, returning to Welcome', async () => {
      const ana = await owner(t, 'ana@acacia.vc')
      const res = await t.client(ana.headers).billing.checkout({ plan: 'pro', cycle: 'yearly' })
      expect(res).toEqual({
        clientSecret: expect.stringMatching(/_secret$/),
        publishableKey: 'pk_test_fake',
      })
      expect(stripe.checkouts.at(-1)).toEqual({
        organizationId: ana.organizationId,
        plan: 'pro',
        cycle: 'yearly',
        customerId: null,
        email: 'ana@acacia.vc',
        returnUrl: `${TEST_WEB_ORIGIN}/app/welcome?session_id={CHECKOUT_SESSION_ID}`,
      })
      expect((await t.client(ana.headers).me.get()).plan).toBe('free')
    })

    it('reuses the customer of an organization that paid before', async () => {
      const ana = await owner(t, 'ana@banyan.vc')
      await t.data.forOrganization(ana.organizationId).setStripeCustomer('cus_banyan')
      await t.client(ana.headers).billing.checkout({ plan: 'team', cycle: 'monthly' })
      expect(stripe.checkouts.at(-1)?.customerId).toBe('cus_banyan')
    })

    it("answers 502 in its own words when Stripe fails, never Stripe's", async () => {
      const ana = await owner(t, 'ana@cypress.vc')
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      stripe.failNext('checkout', new Error('No such price: arrakit_pro_yearly'))
      await expect(
        t.client(ana.headers).billing.checkout({ plan: 'pro', cycle: 'yearly' }),
      ).rejects.toMatchObject({
        status: 502,
        message: "Couldn't open the payment form. Try again in a minute.",
      })
      expect(logged.mock.calls[0]?.[0]).toContain(
        `checkout for organization ${ana.organizationId} failed: No such price`,
      )
    })

    it('refuses a member with 403 and a visitor with 401', async () => {
      const ana = await owner(t, 'ana@dogwood.vc')
      const marta = await joinAs(t, ana.organizationId, 'marta@dogwood.vc', 'member')
      await expect(
        t.client(marta.headers).billing.checkout({ plan: 'pro', cycle: 'yearly' }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        t.client().billing.checkout({ plan: 'pro', cycle: 'yearly' }),
      ).rejects.toMatchObject({ status: 401 })
    })

    it('refuses an organization already on a plan with 409', async () => {
      const ana = await paying(t, stripe, 'ana@ebony.vc')
      await expect(
        t.client(ana.headers).billing.checkout({ plan: 'team', cycle: 'yearly' }),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Your organization is on Pro. Switch plans in Settings → Billing.',
      })
    })

    it.each([
      { plan: 'enterprise', cycle: 'yearly' },
      { plan: 'free', cycle: 'yearly' },
      { plan: 'pro', cycle: 'weekly' },
      { plan: 'pro' },
    ])('refuses %o with 400, opening nothing', async (body) => {
      const ana = await owner(t, `ana@${String(body.plan)}-${String(body.cycle)}.vc`)
      const before = stripe.checkouts.length
      await expect(t.client(ana.headers).billing.checkout(body as never)).rejects.toMatchObject({
        status: 400,
      })
      expect(stripe.checkouts.length).toBe(before)
    })

    it('refuses another site with 403', async () => {
      const ana = await owner(t, 'ana@fig.vc')
      await expect(
        t.client(foreign(ana.headers)).billing.checkout({ plan: 'pro', cycle: 'yearly' }),
      ).rejects.toMatchObject({ status: 403, message: 'Pay from the app.' })
    })
  })

  describe('get', () => {
    it('shows an organization that never paid as Free, asking Stripe nothing', async () => {
      const ana = await owner(t, 'lucia@alder.vc')
      const billing = vi.spyOn(stripe, 'billing')
      await expect(t.client(ana.headers).billing.get()).resolves.toEqual({
        plan: 'free',
        cycle: null,
        renewsOn: null,
        endsOn: null,
        nextInvoice: null,
        scheduledChange: null,
        seats: 1,
        card: null,
        billingEmail: null,
        invoiceTo: 'Alder',
        taxId: null,
        invoices: [],
      })
      expect(billing).not.toHaveBeenCalled()
    })

    it('reads a paying organization from Stripe: renewal, card, details and invoices', async () => {
      const ana = await paying(t, stripe, 'ana@birch.vc')
      await expect(t.client(ana.headers).billing.get()).resolves.toEqual({
        plan: 'pro',
        cycle: 'yearly',
        renewsOn: '2027-10-04',
        endsOn: null,
        nextInvoice: { amount: 143_000, currency: 'usd' },
        scheduledChange: null,
        seats: 3,
        card: { brand: 'visa', last4: '4242' },
        billingEmail: 'finance@alder.vc',
        invoiceTo: 'Alder Ventures SL',
        taxId: 'ESB99286321',
        invoices: [
          {
            id: 'in_2',
            issuedOn: '2026-10-04',
            total: { amount: 143_000, currency: 'usd' },
            status: 'paid',
            pdfUrl: 'https://pay.stripe.test/in_2.pdf',
          },
          {
            id: 'in_1',
            issuedOn: '2026-09-04',
            total: { amount: 14_900, currency: 'usd' },
            status: 'failed',
            pdfUrl: null,
          },
        ],
      })
    })

    it('shows a cancelled plan ending, with nothing more to charge', async () => {
      const snapshot = proYearly()
      snapshot.subscription!.cancelAtPeriodEnd = true
      const ana = await paying(t, stripe, 'ivo@cedar.vc', snapshot)
      await expect(t.client(ana.headers).billing.get()).resolves.toMatchObject({
        renewsOn: null,
        endsOn: '2027-10-04',
        nextInvoice: null,
      })
    })

    it('shows a move down waiting for the renewal, and what the renewal will charge', async () => {
      const snapshot = proYearly()
      snapshot.subscription = {
        status: 'active',
        lookupKey: 'team_yearly',
        periodEnd: RENEWAL,
        cancelAtPeriodEnd: false,
        amount: { amount: 1_440_000, currency: 'usd' },
        scheduled: {
          lookupKey: 'pro_monthly',
          at: RENEWAL,
          amount: { amount: 14_900, currency: 'usd' },
        },
      }
      const ana = await paying(t, stripe, 'nora@larch.vc', snapshot)
      await expect(t.client(ana.headers).billing.get()).resolves.toMatchObject({
        plan: 'team',
        cycle: 'yearly',
        renewsOn: '2027-10-04',
        scheduledChange: { plan: 'pro', cycle: 'monthly', on: '2027-10-04' },
        nextInvoice: { amount: 14_900, currency: 'usd' },
      })
    })

    it('keeps the invoices and card of an organization back on Free after paying before', async () => {
      const dana = await owner(t, 'dana@elm.vc')
      await t.data
        .forOrganization(dana.organizationId)
        .setPlan('free', { customerId: 'cus_elm', subscriptionId: null })
      stripe.bill('cus_elm', { ...proYearly(), subscription: null })
      const billing = await t.client(dana.headers).billing.get()
      expect(billing).toMatchObject({
        plan: 'free',
        cycle: null,
        renewsOn: null,
        nextInvoice: null,
        card: { brand: 'visa', last4: '4242' },
      })
      expect(billing.invoices).toHaveLength(2)
    })

    it("answers 502 in its own words when Stripe fails, never Stripe's", async () => {
      const eva = await paying(t, stripe, 'eva@fir.vc')
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      stripe.failNext('billing', Object.assign(new Error('No such customer'), { statusCode: 404 }))
      await expect(t.client(eva.headers).billing.get()).rejects.toMatchObject({
        status: 502,
        message: "Couldn't load billing from Stripe. Try again in a minute.",
      })
    })

    it('refuses a member with 403', async () => {
      const elena = await paying(t, stripe, 'elena@hazel.vc')
      const marta = await joinAs(t, elena.organizationId, 'marta@hazel.vc', 'member')
      await expect(t.client(marta.headers).billing.get()).rejects.toMatchObject({ status: 403 })
    })
  })

  describe('previewChange', () => {
    it('prices a move up a plan as charged today, prorated', async () => {
      const ana = await paying(t, stripe, 'owner@juniper.vc')
      await expect(
        t.client(ana.headers).billing.previewChange({ plan: 'team', cycle: 'yearly' }),
      ).resolves.toEqual({
        applies: 'now',
        on: new Date().toISOString().slice(0, 10),
        dueToday: FAKE_PRORATION,
        nextInvoice: { amount: 48_000, currency: 'usd' },
      })
    })

    it('prices a move down as nothing today, and the new price from the renewal', async () => {
      const ana = await paying(t, stripe, 'owner@maple.vc')
      await expect(
        t.client(ana.headers).billing.previewChange({ plan: 'pro', cycle: 'monthly' }),
      ).resolves.toEqual({
        applies: 'renewal',
        on: '2027-10-04',
        dueToday: { amount: 0, currency: 'usd' },
        nextInvoice: { amount: 2_000, currency: 'usd' },
      })
    })

    it('refuses the plan and cycle the organization already pays for with 409', async () => {
      const ana = await paying(t, stripe, 'owner@oak.vc')
      await expect(
        t.client(ana.headers).billing.previewChange({ plan: 'pro', cycle: 'yearly' }),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Your organization is already on Pro, billed yearly.',
      })
    })

    it('sends an organization on Free to Checkout with 409', async () => {
      const ana = await owner(t, 'owner@pine.vc')
      await expect(
        t.client(ana.headers).billing.previewChange({ plan: 'pro', cycle: 'yearly' }),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Your organization is on Free. Pick a plan to pay for it.',
      })
    })
  })

  describe('change', () => {
    it('moves an organization up a plan now, and puts it on the new plan at once', async () => {
      const ana = await paying(t, stripe, 'owner@rowan.vc')
      const changeNow = stripe.changeNow
      vi.spyOn(stripe, 'changeNow').mockImplementation(async (id, choice, requestedBy) => {
        await changeNow(id, choice, requestedBy)
        const held = stripe.subscriptions.get(id)!
        stripe.subscribe({ ...held, lookupKey: 'team_yearly' })
      })
      const billing = await t.client(ana.headers).billing.change({ plan: 'team', cycle: 'yearly' })
      expect(billing.plan).toBe('team')
      expect(stripe.changes.at(-1)).toEqual({
        subscriptionId: ana.subscriptionId,
        choice: { plan: 'team', cycle: 'yearly' },
        when: 'now',
      })
      expect((await t.client(ana.headers).me.get()).plan).toBe('team')
    })

    it('schedules a move down for the renewal, keeping the plan until then', async () => {
      const ana = await paying(t, stripe, 'owner@spruce.vc')
      await t.client(ana.headers).billing.change({ plan: 'pro', cycle: 'monthly' })
      expect(stripe.changes.at(-1)).toEqual({
        subscriptionId: ana.subscriptionId,
        choice: { plan: 'pro', cycle: 'monthly' },
        when: 'renewal',
      })
      expect((await t.client(ana.headers).me.get()).plan).toBe('pro')
    })

    it.each([
      { move: 'up a plan, now', choice: { plan: 'team', cycle: 'yearly' } as const },
      {
        move: 'to another cycle, at the renewal',
        choice: { plan: 'pro', cycle: 'monthly' } as const,
      },
    ])('records the admin who asked on the subscription, moving $move', async ({ choice }) => {
      const email = `owner@${choice.plan}-${choice.cycle}.vc`
      const ana = await paying(t, stripe, email)
      expect(stripe.subscriptions.get(ana.subscriptionId)?.requestedBy).toBeNull()
      await t.client(ana.headers).billing.change(choice)
      expect(stripe.subscriptions.get(ana.subscriptionId)?.requestedBy).toBe(email)
    })

    it('answers 402 in its own words when the card is declined, plan unchanged', async () => {
      const ana = await paying(t, stripe, 'owner@teak.vc')
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      stripe.failNext('changeNow', declined())
      await expect(
        t.client(ana.headers).billing.change({ plan: 'team', cycle: 'yearly' }),
      ).rejects.toMatchObject({
        status: 402,
        message: 'Your card was declined. Update it under Payment, then try again.',
      })
      expect((await t.client(ana.headers).me.get()).plan).toBe('pro')
    })

    it('refuses a request from another site with 403, changing nothing', async () => {
      const ana = await paying(t, stripe, 'owner@walnut.vc')
      const before = stripe.changes.length
      await expect(
        t.client(foreign(ana.headers)).billing.change({ plan: 'team', cycle: 'yearly' }),
      ).rejects.toMatchObject({ status: 403, message: 'Change plans from the app.' })
      expect(stripe.changes.length).toBe(before)
    })
  })

  describe('cancel and resume', () => {
    it('cancels at the end of the period, and undoes it, keeping the plan', async () => {
      const ana = await paying(t, stripe, 'owner@willow.vc')
      await t.client(ana.headers).billing.cancel()
      await t.client(ana.headers).billing.resume()
      expect(stripe.cancellations.slice(-2)).toEqual([
        { subscriptionId: ana.subscriptionId, cancel: true },
        { subscriptionId: ana.subscriptionId, cancel: false },
      ])
      expect((await t.client(ana.headers).me.get()).plan).toBe('pro')
    })

    it.each(['cancel', 'change'] as const)(
      'refuses to %s for an organization on Internal with 409',
      async (procedure) => {
        const ana = await paying(t, stripe, `owner@ash${procedure}.vc`)
        await t.data.forOrganization(ana.organizationId).setPlan('internal')
        const before = [stripe.cancellations.length, stripe.changes.length]
        const api = t.client(ana.headers).billing
        const call =
          procedure === 'cancel' ? api.cancel() : api.change({ plan: 'team', cycle: 'yearly' })
        await expect(call).rejects.toMatchObject({
          status: 409,
          message: 'Your organization is on Internal: there is nothing to bill.',
        })
        expect([stripe.cancellations.length, stripe.changes.length]).toEqual(before)
      },
    )

    it('refuses an organization on Free with 409', async () => {
      const ana = await owner(t, 'owner@yew.vc')
      await expect(t.client(ana.headers).billing.cancel()).rejects.toMatchObject({
        status: 409,
        message: 'Your organization is on Free: there is nothing to cancel.',
      })
    })

    it('refuses a member with 403', async () => {
      const ana = await paying(t, stripe, 'owner@alder2.vc')
      const marta = await joinAs(t, ana.organizationId, 'marta@alder2.vc', 'member')
      const before = stripe.cancellations.length
      await expect(t.client(marta.headers).billing.cancel()).rejects.toMatchObject({ status: 403 })
      expect(stripe.cancellations.length).toBe(before)
    })
  })

  describe('portal', () => {
    it("opens Stripe's portal for the organization's customer, coming back to Billing", async () => {
      const ana = await paying(t, stripe, 'owner@acacia2.vc')
      const { url } = await t.client(ana.headers).billing.portal({ to: 'payment' })
      expect(url).toMatch(/^https:\/\/billing\.stripe\.test\//)
      expect(stripe.portals.at(-1)).toEqual({
        customerId: ana.customerId,
        returnUrl: `${TEST_WEB_ORIGIN}/app/billing`,
        to: 'payment',
      })
    })

    it('refuses an organization Stripe has never seen with 409', async () => {
      const ana = await owner(t, 'owner@banyan2.vc')
      await expect(t.client(ana.headers).billing.portal({ to: 'details' })).rejects.toMatchObject({
        status: 409,
        message: 'Your organization has no billing details yet. Pick a plan first.',
      })
    })
  })
})

describe('billing without Stripe', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp({ stripe: null })
  })
  afterAll(() => t.close())

  it('answers 503 for checkout while the rest of the app works', async () => {
    const ana = await owner(t, 'ana@nostripe.vc')
    await expect(
      t.client(ana.headers).billing.checkout({ plan: 'pro', cycle: 'yearly' }),
    ).rejects.toMatchObject({ status: 503, message: 'Payments are not set up yet.' })
    await expect(t.client(ana.headers).billing.get()).resolves.toMatchObject({ plan: 'free' })
    await expect(t.client(ana.headers).me.get()).resolves.toMatchObject({ plan: 'free' })
  })
})

describe('billing.cancel: the cancellation email', () => {
  let t: TestApp
  let stripe: FakeStripe

  beforeAll(async () => {
    stripe = fakeStripe()
    t = await createTestApp({ stripe, env: { WEB_URL: 'https://app.example.test' } })
  })
  afterAll(() => t.close())
  afterEach(() => vi.restoreAllMocks())

  it('emails the admin who cancelled the day the plan ends, and nothing on resume', async () => {
    const ana = await paying(t, stripe, 'owner@willow.vc')
    const from = t.sent.length
    await t.client(ana.headers).billing.cancel()
    const mails = t.sent.slice(from)
    expect(mails.map((mail) => mail.to)).toEqual(['owner@willow.vc'])
    expect(mails[0]?.subject).toBe('Pro ends on Oct 4, 2027')
    expect(mails[0]?.text).toContain('https://app.example.test/app/billing')

    const resumed = t.sent.length
    await t.client(ana.headers).billing.resume()
    expect(t.sent.slice(resumed)).toEqual([])
  })

  it('emails every owner and admin when an admin cancels, never a member', async () => {
    const ana = await paying(t, stripe, 'owner@hazel.vc')
    const admin = await joinAs(t, ana.organizationId, 'admin@hazel.vc', 'admin')
    await joinAs(t, ana.organizationId, 'member@hazel.vc', 'member')
    const from = t.sent.length
    await t.client(admin.headers).billing.cancel()
    const to = t.sent.slice(from).map((mail) => mail.to)
    expect(to).toHaveLength(2)
    expect(to).toEqual(expect.arrayContaining(['admin@hazel.vc', 'owner@hazel.vc']))
  })

  it('still cancels when the email cannot be sent, logging no address or body', async () => {
    const ana = await paying(t, stripe, 'owner@rowan.vc')
    const from = t.sent.length
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(t.deps.mailer, 'send').mockRejectedValue(new Error('[mail] Resend refused: 500'))
    const billing = await t.client(ana.headers).billing.cancel()
    expect(billing.plan).toBe('pro')
    expect(stripe.cancellations.at(-1)).toEqual({
      subscriptionId: ana.subscriptionId,
      cancel: true,
    })
    expect(t.sent.slice(from)).toEqual([])
    const lines = logged.mock.calls.map((call) => call.join('\n'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(`organization ${ana.organizationId}: cancellation email not sent`)
    expect(lines[0]).not.toContain('owner@rowan.vc')
    expect(lines[0]).not.toContain('<html')
  })
})
