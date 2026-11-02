import type Stripe from 'stripe'
import { ORPCError } from '@orpc/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadApiEnv } from '../env'
import { recordingLogger } from '../observability/logger'
import { fakeStripe } from './fake-stripe'
import { PRICE_CACHE_MS, mapStripeEvent, planKeyOf, realStripeGateway } from './real-stripe'
import {
  type SubscriptionState,
  createStripeGateway,
  guardedStripe,
  unconfiguredStripe,
} from './stripe-gateway'

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
}

function heldSubscription() {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    schedule: 'sub_sched_old',
    cancel_at_period_end: false,
    billing_cycle_anchor: 1_760_054_400,
    cancellation_details: { reason: null as string | null },
    metadata: { organizationId: 'organization_1' } as Record<string, string>,
    items: {
      data: [
        {
          id: 'si_1',
          quantity: 1,
          price: { id: 'price_pro_monthly', lookup_key: 'arrakit_pro_monthly' },
          current_period_end: 2_000,
        },
      ],
    },
  }
}

function stripeClient() {
  const sent: { call: string; params: unknown }[] = []
  const held = heldSubscription()
  const record =
    (call: string) =>
    async (...args: unknown[]) => {
      sent.push({ call, params: args.length > 1 ? args[1] : args[0] })
      return {}
    }
  const listPrices = vi.fn(async () => ({
    data: [{ id: 'price_new', product: 'prod_credits', unit_amount: 19_200, currency: 'usd' }],
  }))
  const client = {
    prices: { list: listPrices },
    invoices: {
      createPreview: async (params: unknown) => {
        sent.push({ call: 'invoices.createPreview', params })
        return { amount_due: 9_000, currency: 'usd' }
      },
    },
    customers: {
      retrieve: async (id: string) =>
        id === 'cus_gone'
          ? { id, deleted: true }
          : {
              id,
              email: 'finance@acme.com',
              invoice_settings: {
                default_payment_method: { card: { brand: 'visa', last4: '4242' } },
              },
            },
    },
    checkout: {
      sessions: {
        create: async (params: unknown) => {
          sent.push({ call: 'checkout.sessions.create', params })
          return { client_secret: 'cs_secret', url: 'https://checkout.stripe.test/c/pay/cs_1' }
        },
      },
    },
    paymentIntents: {
      retrieve: async (id: string) => ({
        id,
        amount: 2_420,
        metadata:
          id === 'pi_top_up'
            ? { kind: 'top_up', organizationId: 'organization_1', cents: '2000' }
            : {},
      }),
    },
    subscriptions: {
      retrieve: async () => held,
      update: async (_id: string, params: unknown) => {
        sent.push({ call: 'subscriptions.update', params })
        return held
      },
      cancel: record('subscriptions.cancel'),
    },
    subscriptionSchedules: {
      release: record('subscriptionSchedules.release'),
      create: async () => ({
        id: 'sub_sched_new',
        phases: [
          {
            start_date: 1_000,
            end_date: 2_000,
            items: [{ price: 'price_pro_monthly', quantity: 1 }],
            discounts: [{ discount: 'di_1' }],
          },
        ],
      }),
      update: async (_id: string, params: unknown) => {
        sent.push({ call: 'subscriptionSchedules.update', params })
        return {}
      },
    },
  }
  return { client: client as unknown as Stripe, sent, held, listPrices }
}

const state = (fields: Partial<SubscriptionState> = {}): SubscriptionState => ({
  id: 'sub_1',
  customerId: 'cus_1',
  organizationId: 'organization_1',
  cancellationReason: null,
  status: 'active',
  lookupKey: 'pro_monthly',
  anchor: new Date(1_760_054_400 * 1000),
  periodEnd: 2_000,
  itemId: 'si_1',
  scheduleId: 'sub_sched_old',
  ...fields,
})

const event = (type: string, object: object, extra: object = {}) =>
  ({ type, data: { object, ...extra } }) as unknown as Stripe.Event

describe('createStripeGateway', () => {
  it.each(Object.keys(ENV))('answers 503 without %s: payments are not set up', async (missing) => {
    for (const value of [undefined, '']) {
      const gateway = createStripeGateway(loadApiEnv({ ...ENV, [missing]: value }))
      await expect(gateway.portal('cus_1', 'https://app.test', 'payment')).rejects.toThrow(
        'Payments are not set up yet.',
      )
      expect(() => gateway.event('{}', 'sig')).toThrow('Stripe is not set up')
    }
  })

  it('carries the publishable key once all three are set', () => {
    expect(createStripeGateway(loadApiEnv(ENV)).publishableKey).toBe('pk_test_x')
  })

  it('is the in-memory fake with STRIPE_FAKE=1', () => {
    expect(createStripeGateway(loadApiEnv({ STRIPE_FAKE: '1' })).publishableKey).toBe(
      'pk_test_fake',
    )
  })
})

describe('guardedStripe', () => {
  const declined = () =>
    Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError' })

  it('answers a declined card 402 and any other failure 502, logging both', async () => {
    const fake = fakeStripe()
    const { log, logs } = recordingLogger()
    const guarded = guardedStripe(fake, log)
    fake.failNext('portal', declined())
    fake.failNext('portal', new Error('socket hang up'))

    await expect(guarded.portal('cus_1', 'https://app.test', 'payment')).rejects.toMatchObject({
      status: 402,
      message: 'Your card was declined. Update it under Payment, then try again.',
    })
    await expect(guarded.portal('cus_1', 'https://app.test', 'payment')).rejects.toMatchObject({
      status: 502,
      message: "Couldn't reach Stripe. Try again in a minute.",
    })
    expect(logs.filter((entry) => entry.msg === 'Stripe call failed')).toEqual([
      expect.objectContaining({ operation: 'portal', err: expect.objectContaining({}) }),
      expect.objectContaining({ operation: 'portal' }),
    ])
  })

  it('answers 503 without Stripe keys, unlogged, and leaves webhook signature failures as they are', async () => {
    const { log, logs } = recordingLogger()
    const guarded = guardedStripe(unconfiguredStripe(), log)
    const error = await guarded.billing('cus_1', null).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({ status: 503, message: 'Payments are not set up yet.' })
    expect(logs).toEqual([])
    expect(() => guarded.event('{}', 'sig')).toThrow('Stripe is not set up')
  })

  it('builds its refusals with the factory it is given', async () => {
    const fake = fakeStripe()
    const guarded = guardedStripe(fake, recordingLogger().log, (code, message) =>
      Object.assign(new Error(message), { code }),
    )
    fake.failNext('endNow', new Error('socket hang up'))
    await expect(guarded.endNow('sub_1')).rejects.toMatchObject({
      code: 'BAD_GATEWAY',
      message: "Couldn't reach Stripe. Try again in a minute.",
    })
  })
})

describe('the real gateway', () => {
  let stripe: ReturnType<typeof stripeClient>
  let gateway: ReturnType<typeof realStripeGateway>

  beforeEach(() => {
    stripe = stripeClient()
    gateway = realStripeGateway(
      { secretKey: 'sk', publishableKey: 'pk', webhookSecret: 'whsec' },
      stripe.client,
    )
  })

  const params = (call: string) => stripe.sent.filter((s) => s.call === call).map((s) => s.params)

  it("opens Embedded Checkout with the paying admin's email", async () => {
    await gateway.checkout({
      organizationId: 'organization_1',
      plan: 'pro',
      cycle: 'yearly',
      customerId: null,
      email: 'ana@acme.com',
      returnUrl: 'https://app.test/app/welcome?session_id={CHECKOUT_SESSION_ID}',
    })
    expect(params('checkout.sessions.create')[0]).toMatchObject({
      ui_mode: 'embedded_page',
      mode: 'subscription',
      line_items: [{ price: 'price_new', quantity: 1 }],
      client_reference_id: 'organization_1',
      subscription_data: { metadata: { organizationId: 'organization_1' } },
      customer_email: 'ana@acme.com',
      tax_id_collection: { enabled: true },
    })
  })

  it('reuses a returning customer, letting Stripe update its name and address', async () => {
    await gateway.checkout({
      organizationId: 'organization_1',
      plan: 'pro',
      cycle: 'yearly',
      customerId: 'cus_9',
      email: 'ana@acme.com',
      returnUrl: 'https://app.test',
    })
    expect(params('checkout.sessions.create')[0]).toMatchObject({
      customer: 'cus_9',
      customer_update: { name: 'auto', address: 'auto' },
    })
  })

  it('changes now, prorating and refusing an incomplete payment, and answers the changed subscription', async () => {
    const changed = await gateway.changeNow(state(), { plan: 'team', cycle: 'yearly' }, 1_500)
    expect(params('subscriptionSchedules.release')).toEqual(['sub_sched_old'])
    expect(params('subscriptions.update')[0]).toEqual({
      items: [{ id: 'si_1', price: 'price_new' }],
      proration_behavior: 'always_invoice',
      proration_date: 1_500,
      payment_behavior: 'error_if_incomplete',
      cancel_at_period_end: false,
    })
    expect(changed).toMatchObject({ id: 'sub_1', lookupKey: 'pro_monthly', itemId: 'si_1' })
  })

  it('schedules a change at renewal keeping the organization and the discounts in both phases', async () => {
    const kept = await gateway.changeAtRenewal(state(), { plan: 'pro', cycle: 'yearly' })
    const metadata = { organizationId: 'organization_1' }
    expect(params('subscriptions.update')[0]).toEqual({ cancel_at_period_end: false })
    expect(kept).toMatchObject({ id: 'sub_1', scheduleId: 'sub_sched_new' })
    expect(params('subscriptionSchedules.update')[0]).toEqual({
      end_behavior: 'release',
      phases: [
        {
          items: [{ price: 'price_pro_monthly', quantity: 1 }],
          start_date: 1_000,
          end_date: 2_000,
          discounts: [{ discount: 'di_1' }],
          metadata,
        },
        {
          items: [{ price: 'price_new', quantity: 1 }],
          duration: { interval: 'year' },
          billing_cycle_anchor: 'phase_start',
          proration_behavior: 'none',
          discounts: [{ discount: 'di_1' }],
          metadata,
        },
      ],
    })
  })

  it('keeps a coupon or promotion code of the current phase and drops empty discounts', async () => {
    const schedules = (
      stripe.client as unknown as {
        subscriptionSchedules: { create: () => Promise<unknown> }
      }
    ).subscriptionSchedules
    schedules.create = async () => ({
      id: 'sub_sched_new',
      phases: [
        {
          start_date: 1_000,
          end_date: 2_000,
          items: [{ price: 'price_pro_monthly', quantity: 1 }],
          discounts: [
            { discount: null, coupon: 'co_1', promotion_code: null },
            { discount: null, coupon: null, promotion_code: { id: 'promo_1' } },
            { discount: null, coupon: null, promotion_code: null },
          ],
        },
      ],
    })
    await gateway.changeAtRenewal(state(), { plan: 'pro', cycle: 'monthly' })
    const { phases } = params('subscriptionSchedules.update')[0] as {
      phases: { discounts: unknown }[]
    }
    const expected = [{ coupon: 'co_1' }, { promotion_code: 'promo_1' }]
    expect(phases.map((phase) => phase.discounts)).toEqual([expected, expected])
  })

  it('reads the plan, the period, the item, the schedule, the anchor and the cancellation reason', async () => {
    stripe.held.cancellation_details = { reason: 'payment_failed' }
    await expect(gateway.subscription('sub_1')).resolves.toEqual(
      state({ cancellationReason: 'payment_failed' }),
    )
  })

  it('reads the email and card of a customer, and nothing of a deleted one', async () => {
    await expect(gateway.customer('cus_1')).resolves.toEqual({
      email: 'finance@acme.com',
      card: { brand: 'visa', last4: '4242' },
    })
    await expect(gateway.customer('cus_gone')).resolves.toEqual({ email: null, card: null })
  })

  it('looks each price up once', async () => {
    await gateway.price({ plan: 'pro', cycle: 'yearly' })
    await gateway.price({ plan: 'pro', cycle: 'yearly' })
    await gateway.price({ plan: 'team', cycle: 'yearly' })
    expect(stripe.listPrices).toHaveBeenCalledTimes(2)
  })

  it('previews a change now prorated at the date the change will reuse', async () => {
    const choice = { plan: 'team', cycle: 'yearly' } as const
    await expect(gateway.previewNow(state(), choice, 1_500)).resolves.toEqual({
      amount: 9_000,
      currency: 'usd',
    })
    await gateway.changeNow(state(), choice, 1_500)
    const preview = params('invoices.createPreview')[0] as {
      subscription_details: { proration_date: number }
    }
    const update = params('subscriptions.update')[0] as { proration_date: number }
    expect(preview.subscription_details.proration_date).toBe(1_500)
    expect(update.proration_date).toBe(preview.subscription_details.proration_date)
  })

  describe('prices', () => {
    afterEach(() => vi.useRealTimers())

    it('looks a price up again once its cache has expired', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      await gateway.price({ plan: 'pro', cycle: 'yearly' })
      vi.advanceTimersByTime(PRICE_CACHE_MS - 1)
      await gateway.price({ plan: 'pro', cycle: 'yearly' })
      expect(stripe.listPrices).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(2)
      await gateway.price({ plan: 'pro', cycle: 'yearly' })
      expect(stripe.listPrices).toHaveBeenCalledTimes(2)
    })

    it('looks a price up again after a failed lookup', async () => {
      stripe.listPrices.mockRejectedValueOnce(new Error('Stripe is down'))
      await expect(gateway.price({ plan: 'pro', cycle: 'yearly' })).rejects.toThrow()
      await expect(gateway.price({ plan: 'pro', cycle: 'yearly' })).resolves.toMatchObject({
        amount: 19_200,
      })
      expect(stripe.listPrices).toHaveBeenCalledTimes(2)
    })

    it('looks the price up fresh for every change, whatever was shown', async () => {
      const choice = { plan: 'team', cycle: 'yearly' } as const
      await gateway.price(choice)
      stripe.listPrices.mockResolvedValueOnce({ data: [{ id: 'price_rotated' }] } as never)
      await gateway.changeNow(state(), choice, 1_500)
      expect(params('subscriptions.update')).toMatchObject([
        { items: [{ price: 'price_rotated' }] },
      ])
      await gateway.changeNow(state(), choice, 1_500)
      expect(stripe.listPrices).toHaveBeenCalledTimes(3)
    })

    it('refuses a change to a missing price before releasing the schedule', async () => {
      stripe.listPrices.mockResolvedValueOnce({ data: [] } as never)
      await expect(
        gateway.changeAtRenewal(state(), { plan: 'pro', cycle: 'yearly' }),
      ).rejects.toThrow(/no active Stripe price/)
      expect(params('subscriptionSchedules.release')).toEqual([])
    })
  })

  it('cancels at the period end, releasing a schedule first, and resumes', async () => {
    await gateway.cancelAtPeriodEnd(state(), true)
    await gateway.cancelAtPeriodEnd(state(), false)
    expect(params('subscriptionSchedules.release')).toEqual(['sub_sched_old'])
    expect(params('subscriptions.update')).toEqual([
      { cancel_at_period_end: true },
      { cancel_at_period_end: false },
    ])
  })

  it('opens a hosted top-up Checkout under the Credits product', async () => {
    const { url } = await gateway.topUpCheckout({
      organizationId: 'organization_1',
      cents: 2_000,
      customerId: null,
      email: 'ana@acme.com',
      successUrl: 'https://app.test/app/billing?top_up=paid',
      cancelUrl: 'https://app.test/app/billing',
    })
    expect(url).toBe('https://checkout.stripe.test/c/pay/cs_1')
    expect(params('checkout.sessions.create')[0]).toMatchObject({
      mode: 'payment',
      line_items: [
        {
          price_data: { currency: 'usd', product: 'prod_credits', unit_amount: 2_000 },
          quantity: 1,
        },
      ],
      metadata: { kind: 'top_up', organizationId: 'organization_1' },
      payment_intent_data: {
        metadata: { kind: 'top_up', organizationId: 'organization_1', cents: '2000' },
      },
      invoice_creation: { enabled: true, invoice_data: { metadata: { kind: 'top_up' } } },
      customer_email: 'ana@acme.com',
      customer_creation: 'always',
    })
  })

  it('reads a top-up payment, and nothing from another payment', async () => {
    await expect(gateway.topUpPayment('pi_top_up')).resolves.toEqual({
      organizationId: 'organization_1',
      cents: 2_000,
      total: 2_420,
    })
    await expect(gateway.topUpPayment('pi_other')).resolves.toBeNull()
  })

  it('ends a live subscription now, and leaves a cancelled one alone', async () => {
    await gateway.endNow('sub_1')
    stripe.held.status = 'canceled'
    await gateway.endNow('sub_1')
    expect(params('subscriptions.cancel')).toEqual(['sub_1'])
  })
})

describe('planKeyOf', () => {
  it('reads the lookup key without its prefix', () => {
    expect(planKeyOf({ lookup_key: 'arrakit_pro_yearly' })).toBe('pro_yearly')
    expect(planKeyOf({ lookup_key: null })).toBeNull()
  })
})

describe('mapStripeEvent', () => {
  const subscription = {
    id: 'sub_1',
    metadata: { organizationId: 'organization_1' },
    items: { data: [{ price: { lookup_key: 'arrakit_pro_yearly' } }] },
  }
  const invoice = (fields: object) => ({
    id: 'in_1',
    amount_due: 19_200,
    amount_paid: 19_200,
    currency: 'usd',
    invoice_pdf: 'https://pay.stripe.test/in_1.pdf',
    next_payment_attempt: 1_800_000_000,
    parent: { subscription_details: { subscription: 'sub_1' } },
    ...fields,
  })

  it('reads a subscription Checkout completed as a subscription event', () => {
    expect(
      mapStripeEvent(
        event('checkout.session.completed', {
          mode: 'subscription',
          subscription: 'sub_1',
          client_reference_id: 'organization_1',
        }),
      ),
    ).toEqual({ kind: 'subscription', subscriptionId: 'sub_1', organizationId: 'organization_1' })
    expect(
      mapStripeEvent(event('checkout.session.async_payment_succeeded', { mode: 'subscription' })),
    ).toBeNull()
  })

  it.each(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])(
    'reads a top-up from %s',
    (type) => {
      expect(
        mapStripeEvent(
          event(type, {
            id: 'cs_1',
            mode: 'payment',
            metadata: { kind: 'top_up', organizationId: 'organization_1' },
            client_reference_id: 'organization_1',
            customer: 'cus_1',
            amount_subtotal: 2_000,
            payment_status: 'paid',
          }),
        ),
      ).toEqual({
        kind: 'top-up',
        sessionId: 'cs_1',
        organizationId: 'organization_1',
        customerId: 'cus_1',
        cents: 2_000,
        paid: true,
      })
    },
  )

  it('ignores a payment Checkout that is no top-up', () => {
    expect(
      mapStripeEvent(event('checkout.session.completed', { mode: 'payment', metadata: {} })),
    ).toBeNull()
  })

  it.each(['refund.created', 'charge.dispute.created'])('reads %s as money back', (type) => {
    expect(
      mapStripeEvent(event(type, { id: 're_1', payment_intent: 'pi_1', amount: 1_210 })),
    ).toEqual({
      kind: 'payment-reversed',
      reversalId: 're_1',
      paymentIntentId: 'pi_1',
      amount: 1_210,
    })
    expect(mapStripeEvent(event(type, { id: 're_2', payment_intent: null, amount: 1 }))).toBeNull()
  })

  it('reads a subscription change as a subscription event', () => {
    expect(mapStripeEvent(event('customer.subscription.updated', subscription))).toEqual({
      kind: 'subscription',
      subscriptionId: 'sub_1',
      organizationId: 'organization_1',
    })
  })

  it('reads the invoice events of a subscription', () => {
    expect(mapStripeEvent(event('invoice.upcoming', invoice({})))).toEqual({
      kind: 'invoice-upcoming',
      subscriptionId: 'sub_1',
      amount: { amount: 19_200, currency: 'usd' },
    })
    expect(mapStripeEvent(event('invoice.payment_failed', invoice({})))).toMatchObject({
      kind: 'invoice-failed',
      nextAttempt: 1_800_000_000,
    })
    expect(
      mapStripeEvent(event('invoice.payment_failed', invoice({ next_payment_attempt: null }))),
    ).toMatchObject({ nextAttempt: null })
    expect(
      mapStripeEvent(
        event(
          'invoice.paid',
          invoice({
            billing_reason: 'subscription_cycle',
            parent: { subscription_details: { subscription: { id: 'sub_1' } } },
          }),
        ),
      ),
    ).toEqual({
      kind: 'invoice-paid',
      subscriptionId: 'sub_1',
      amount: { amount: 19_200, currency: 'usd' },
      invoiceUrl: 'https://pay.stripe.test/in_1.pdf',
    })
  })

  it.each(['subscription_create', 'subscription_cycle', 'subscription_update'])(
    'reads a paid invoice for %s, linking the hosted page without a PDF',
    (billing_reason) => {
      expect(
        mapStripeEvent(
          event(
            'invoice.paid',
            invoice({
              billing_reason,
              invoice_pdf: null,
              hosted_invoice_url: 'https://invoice.stripe.test/i/1',
            }),
          ),
        ),
      ).toMatchObject({ kind: 'invoice-paid', invoiceUrl: 'https://invoice.stripe.test/i/1' })
    },
  )

  it.each(['manual', 'upcoming', null])('ignores a paid invoice for %s', (billing_reason) => {
    expect(mapStripeEvent(event('invoice.paid', invoice({ billing_reason })))).toBeNull()
  })

  it('ignores invoices without a subscription and unknown events', () => {
    expect(mapStripeEvent(event('invoice.upcoming', invoice({ parent: null })))).toBeNull()
    expect(mapStripeEvent(event('customer.created', {}))).toBeNull()
  })
})
