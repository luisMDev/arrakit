import { CURRENCY } from '@arrakit/plans'
import Stripe from 'stripe'

import type {
  BillingEvent,
  BillingSnapshot,
  Card,
  Money,
  StripeGateway,
  SubscriptionSnapshot,
  SubscriptionState,
} from './stripe-gateway'
import { PRICE_KEY_PREFIX, type PaidSubscription, priceLookupKey } from './subscription-plan'

interface StripeKeys {
  secretKey: string
  publishableKey: string
  webhookSecret: string
}

export const TOP_UP_LOOKUP_KEY = `${PRICE_KEY_PREFIX}credits_top_up`
const PORTAL_METADATA_KEY = 'app'

const INVOICE_STATUSES = ['paid', 'open', 'uncollectible'] as const
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
])
const CHECKOUT_PAID_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
])
const INVOICE_EVENTS = new Set(['invoice.upcoming', 'invoice.payment_failed', 'invoice.paid'])

export const planKeyOf = (price: Pick<Stripe.Price, 'lookup_key'>): string | null =>
  price.lookup_key ? price.lookup_key.replace(PRICE_KEY_PREFIX, '') : null

const priceMoney = (
  price: Stripe.Price | string | Stripe.DeletedPrice | undefined,
): Money | null =>
  typeof price === 'object' && !price.deleted && price.unit_amount !== null
    ? { amount: price.unit_amount, currency: price.currency }
    : null

const idOf = (ref: string | { id: string } | null | undefined): string | null =>
  typeof ref === 'string' ? ref : (ref?.id ?? null)

function subscriptionSnapshot(subscription: Stripe.Subscription): SubscriptionSnapshot {
  const item = subscription.items.data[0]!
  const periodEnd = item.current_period_end
  const schedule = typeof subscription.schedule === 'object' ? subscription.schedule : null
  const next = schedule?.phases.find((phase) => phase.start_date >= periodEnd)
  const nextPrice = next?.items[0]?.price
  return {
    status: subscription.status,
    lookupKey: planKeyOf(item.price),
    periodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    amount: priceMoney(item.price),
    scheduled: next
      ? {
          lookupKey:
            typeof nextPrice === 'object' && !nextPrice.deleted ? planKeyOf(nextPrice) : null,
          at: next.start_date,
          amount: priceMoney(nextPrice),
        }
      : null,
  }
}

const cardOf = (method: string | Stripe.PaymentMethod | null | undefined): Card | null =>
  typeof method === 'object' && method?.card
    ? { brand: method.card.brand, last4: method.card.last4 }
    : null

function subscriptionState(subscription: Stripe.Subscription): SubscriptionState {
  const item = subscription.items.data[0]!
  return {
    id: subscription.id,
    customerId: idOf(subscription.customer) ?? '',
    organizationId: subscription.metadata.organizationId ?? null,
    cancellationReason: subscription.cancellation_details?.reason ?? null,
    status: subscription.status,
    lookupKey: planKeyOf(item.price),
    anchor: new Date(subscription.billing_cycle_anchor * 1000),
    periodEnd: item.current_period_end,
    itemId: item.id,
    scheduleId: idOf(subscription.schedule),
  }
}

function memoised<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => {
    pending ??= load().catch((err: unknown) => {
      pending = null
      throw err
    })
    return pending
  }
}

export function mapStripeEvent(event: Stripe.Event): BillingEvent | null {
  if (event.type === 'refund.created' || event.type === 'charge.dispute.created') {
    const reversal = event.data.object
    const paymentIntentId = idOf(reversal.payment_intent)
    if (!paymentIntentId) return null
    return {
      kind: 'payment-reversed',
      reversalId: reversal.id,
      paymentIntentId,
      amount: reversal.amount,
    }
  }
  if (CHECKOUT_PAID_EVENTS.has(event.type)) {
    const session = event.data.object as Stripe.Checkout.Session
    if (session.mode === 'payment') {
      if (session.metadata?.kind !== 'top_up') return null
      return {
        kind: 'top-up',
        sessionId: session.id,
        organizationId: session.metadata.organizationId ?? session.client_reference_id,
        customerId: idOf(session.customer),
        cents: session.amount_subtotal ?? 0,
        paid: session.payment_status === 'paid',
      }
    }
    if (event.type !== 'checkout.session.completed') return null
    return {
      kind: 'subscription',
      subscriptionId: idOf(session.subscription),
      organizationId: session.client_reference_id,
    }
  }
  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    const subscription = event.data.object as Stripe.Subscription
    return {
      kind: 'subscription',
      subscriptionId: subscription.id,
      organizationId: subscription.metadata?.organizationId ?? null,
    }
  }
  if (!INVOICE_EVENTS.has(event.type)) return null
  const invoice = event.data.object as Stripe.Invoice
  const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription)
  if (!subscriptionId) return null
  const due = { amount: invoice.amount_due, currency: invoice.currency }
  if (event.type === 'invoice.upcoming') {
    return { kind: 'invoice-upcoming', subscriptionId, amount: due }
  }
  if (event.type === 'invoice.payment_failed') {
    return {
      kind: 'invoice-failed',
      subscriptionId,
      amount: due,
      nextAttempt: invoice.next_payment_attempt,
    }
  }
  if (!invoice.billing_reason?.startsWith('subscription')) return null
  return {
    kind: 'invoice-paid',
    subscriptionId,
    amount: { amount: invoice.amount_paid, currency: invoice.currency },
    invoiceUrl: invoice.invoice_pdf ?? invoice.hosted_invoice_url ?? null,
  }
}

export function realStripeGateway(keys: StripeKeys, stripe = new Stripe(keys.secretKey)) {
  const prices = new Map<string, () => Promise<Stripe.Price>>()
  const priceByKey = (key: string): Promise<Stripe.Price> => {
    let load = prices.get(key)
    if (!load) {
      load = memoised(async () => {
        const [price] = (await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 }))
          .data
        if (!price) throw new Error(`[billing] no active Stripe price with lookup key ${key}`)
        return price
      })
      prices.set(key, load)
    }
    return load()
  }
  const priceOf = ({ plan, cycle }: PaidSubscription) => priceByKey(priceLookupKey(plan, cycle))

  const topUpProduct = async () => {
    const price = await priceByKey(TOP_UP_LOOKUP_KEY)
    return typeof price.product === 'string' ? price.product : price.product.id
  }

  const portalConfiguration = memoised(async () => {
    const existing = (
      await stripe.billingPortal.configurations.list({ active: true, limit: 100 })
    ).data.find((configuration) => configuration.metadata?.[PORTAL_METADATA_KEY] === 'billing')
    if (existing) return existing.id
    const created = await stripe.billingPortal.configurations.create({
      metadata: { [PORTAL_METADATA_KEY]: 'billing' },
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        customer_update: { enabled: true, allowed_updates: ['email', 'name', 'address', 'tax_id'] },
        subscription_cancel: { enabled: false },
        subscription_update: { enabled: false },
      },
    })
    return created.id
  })

  const releaseSchedule = async (subscription: SubscriptionState): Promise<void> => {
    if (subscription.scheduleId) await stripe.subscriptionSchedules.release(subscription.scheduleId)
  }

  const customerFields = (customerId: string | null, email: string) =>
    customerId
      ? {
          customer: customerId,
          customer_update: { name: 'auto' as const, address: 'auto' as const },
        }
      : { customer_email: email }

  const gateway: StripeGateway = {
    publishableKey: keys.publishableKey,

    async checkout({ organizationId, plan, cycle, customerId, email, returnUrl }) {
      const price = await priceOf({ plan, cycle })
      const session = await stripe.checkout.sessions.create({
        ui_mode: 'embedded_page',
        mode: 'subscription',
        line_items: [{ price: price.id, quantity: 1 }],
        client_reference_id: organizationId,
        subscription_data: { metadata: { organizationId } },
        ...customerFields(customerId, email),
        allow_promotion_codes: true,
        billing_address_collection: 'required',
        tax_id_collection: { enabled: true },
        return_url: returnUrl,
      })
      if (!session.client_secret) throw new Error('[billing] Checkout gave no client secret')
      return { clientSecret: session.client_secret }
    },

    async topUpCheckout({ organizationId, cents, customerId, email, successUrl, cancelUrl }) {
      const product = await topUpProduct()
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          { price_data: { currency: CURRENCY, product, unit_amount: cents }, quantity: 1 },
        ],
        client_reference_id: organizationId,
        metadata: { kind: 'top_up', organizationId },
        payment_intent_data: { metadata: { kind: 'top_up', organizationId, cents: String(cents) } },
        invoice_creation: { enabled: true, invoice_data: { metadata: { kind: 'top_up' } } },
        ...(customerId
          ? { customer: customerId, customer_update: { name: 'auto', address: 'auto' } }
          : { customer_email: email, customer_creation: 'always' }),
        billing_address_collection: 'required',
        tax_id_collection: { enabled: true },
        success_url: successUrl,
        cancel_url: cancelUrl,
      })
      if (!session.url) throw new Error('[billing] Checkout gave no URL')
      return { url: session.url }
    },

    async topUpPayment(paymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId)
      const { kind, organizationId, cents } = intent.metadata
      if (kind !== 'top_up' || !organizationId || !cents) return null
      return { organizationId, cents: Number(cents), total: intent.amount }
    },

    event(rawBody, signature) {
      return mapStripeEvent(stripe.webhooks.constructEvent(rawBody, signature, keys.webhookSecret))
    },

    async subscription(id) {
      return subscriptionState(await stripe.subscriptions.retrieve(id))
    },

    async customer(id) {
      const customer = await stripe.customers.retrieve(id, {
        expand: ['invoice_settings.default_payment_method'],
      })
      if (customer.deleted) return { email: null, card: null }
      return {
        email: customer.email,
        card: cardOf(customer.invoice_settings.default_payment_method),
      }
    },

    async billing(customerId, subscriptionId): Promise<BillingSnapshot> {
      const [customer, subscription, invoices] = await Promise.all([
        stripe.customers.retrieve(customerId, {
          expand: ['invoice_settings.default_payment_method', 'tax_ids'],
        }),
        subscriptionId
          ? stripe.subscriptions.retrieve(subscriptionId, {
              expand: ['default_payment_method', 'schedule.phases.items.price'],
            })
          : null,
        stripe.invoices.list({ customer: customerId, limit: 24 }),
      ])
      const live = customer.deleted ? null : customer
      return {
        subscription: subscription && subscriptionSnapshot(subscription),
        customer: live && {
          email: live.email,
          name: live.name ?? null,
          taxId: live.tax_ids?.data[0]?.value ?? null,
          card:
            cardOf(subscription?.default_payment_method) ??
            cardOf(live.invoice_settings.default_payment_method),
        },
        invoices: invoices.data.flatMap((invoice) => {
          const status = INVOICE_STATUSES.find((shown) => shown === invoice.status)
          if (!status || !invoice.id) return []
          return [
            {
              id: invoice.id,
              created: invoice.created,
              total: { amount: invoice.total, currency: invoice.currency },
              status,
              pdfUrl: invoice.invoice_pdf ?? null,
            },
          ]
        }),
      }
    },

    async price(choice) {
      const price = await priceOf(choice)
      const money = priceMoney(price)
      if (!money) throw new Error(`[billing] price ${price.id} has no unit amount`)
      return money
    },

    async previewNow(subscription, choice) {
      const price = await priceOf(choice)
      const preview = await stripe.invoices.createPreview({
        subscription: subscription.id,
        subscription_details: {
          items: [{ id: subscription.itemId, price: price.id }],
          proration_behavior: 'always_invoice',
          proration_date: Math.floor(Date.now() / 1000),
        },
      })
      return { amount: preview.amount_due, currency: preview.currency }
    },

    async changeNow(subscription, choice) {
      const price = await priceOf(choice)
      await releaseSchedule(subscription)
      const changed = await stripe.subscriptions.update(subscription.id, {
        items: [{ id: subscription.itemId, price: price.id }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
        cancel_at_period_end: false,
      })
      return subscriptionState(changed)
    },

    async changeAtRenewal(subscription, choice) {
      const price = await priceOf(choice)
      await releaseSchedule(subscription)
      const kept = await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: false,
      })
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id,
      })
      const current = schedule.phases[0]
      if (!current) throw new Error(`[billing] schedule ${schedule.id} has no phase`)
      // Keep whatever the current phase carries (an existing discount, a coupon
      // or a promotion code), dropping empty entries Stripe would refuse.
      const metadata: Stripe.MetadataParam = subscription.organizationId
        ? { organizationId: subscription.organizationId }
        : {}
      const discounts = current.discounts.flatMap(
        (entry): Stripe.SubscriptionScheduleUpdateParams.Phase.Discount[] => {
          const discount = idOf(entry.discount)
          if (discount) return [{ discount }]
          const coupon = idOf(entry.coupon)
          if (coupon) return [{ coupon }]
          const promotionCode = idOf(entry.promotion_code)
          return promotionCode ? [{ promotion_code: promotionCode }] : []
        },
      )
      await stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: 'release',
        phases: [
          {
            items: current.items.map((item) => ({
              price: idOf(item.price) ?? '',
              quantity: item.quantity ?? 1,
            })),
            start_date: current.start_date,
            end_date: current.end_date,
            discounts,
            metadata,
          },
          {
            items: [{ price: price.id, quantity: 1 }],
            duration: { interval: choice.cycle === 'yearly' ? 'year' : 'month' },
            billing_cycle_anchor: 'phase_start',
            proration_behavior: 'none',
            discounts,
            metadata,
          },
        ],
      })
      return { ...subscriptionState(kept), scheduleId: schedule.id }
    },

    async cancelAtPeriodEnd(subscription, cancel) {
      if (cancel) await releaseSchedule(subscription)
      await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: cancel })
    },

    async endNow(subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      if (subscription.status === 'canceled') return
      await stripe.subscriptions.cancel(subscriptionId)
    },

    async portal(customerId, returnUrl, to) {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        configuration: await portalConfiguration(),
        return_url: returnUrl,
        ...(to === 'payment' && { flow_data: { type: 'payment_method_update' as const } }),
      })
      return session.url
    },
  }
  return gateway
}
