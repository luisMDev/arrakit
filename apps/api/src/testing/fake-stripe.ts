import { PLAN_OFFERS } from '@arrakit/plans'

import type {
  BillingEvent,
  BillingSnapshot,
  CheckoutRequest,
  PortalTarget,
  StripeGateway,
  SubscriptionEvent,
  SubscriptionState,
  TopUpRequest,
} from '../billing/stripe-gateway'
import type { PaidSubscription } from '../billing/subscription-plan'

export const FAKE_STRIPE_SIGNATURE = 't=1,v1=fake-stripe-signature'
export const FAKE_PRORATION = { amount: 120_000, currency: 'usd' } as const

interface FakeChange {
  subscriptionId: string
  choice: PaidSubscription
  when: 'now' | 'renewal'
}

type OptionalState = 'requestedBy' | 'receiptFor' | 'cancellationReason' | 'anchor'
type FakeSubscription = Omit<SubscriptionState, OptionalState | 'anchor'> &
  Partial<Pick<SubscriptionState, OptionalState>> & { anchor?: Date | string }

/**
 * A webhook body for the fake: a BillingEvent as JSON (kind `subscription` when left out).
 * `subscribe` and `bill` let a dev or e2e run put state into the fake with the same delivery.
 */
type FakeWebhookBody = Partial<BillingEvent> & {
  subscribe?: FakeSubscription
  bill?: { customerId: string; snapshot: BillingSnapshot }
}

interface FakeStripeRecords {
  checkouts: CheckoutRequest[]
  topUps: TopUpRequest[]
  topUpPayments: Map<string, { organizationId: string; cents: number; total: number }>
  changes: FakeChange[]
  cancellations: { subscriptionId: string; cancel: boolean }[]
  ended: string[]
  portals: { customerId: string; returnUrl: string; to: PortalTarget }[]
  subscriptions: Map<string, SubscriptionState>
  customers: Map<string, BillingSnapshot>
  subscribe(state: FakeSubscription): void
  bill(customerId: string, snapshot: BillingSnapshot): void
  /** Makes the next calls of `method` throw `error` (once each, in order). */
  failNext(method: keyof StripeGateway, error: unknown): void
}

export type FakeStripe = StripeGateway & FakeStripeRecords

export function fakeStripe(): FakeStripe {
  const checkouts: CheckoutRequest[] = []
  const topUps: TopUpRequest[] = []
  const topUpPayments = new Map<string, { organizationId: string; cents: number; total: number }>()
  const changes: FakeChange[] = []
  const cancellations: { subscriptionId: string; cancel: boolean }[] = []
  const ended: string[] = []
  const portals: { customerId: string; returnUrl: string; to: PortalTarget }[] = []
  const subscriptions = new Map<string, SubscriptionState>()
  const customers = new Map<string, BillingSnapshot>()
  const failures = new Map<string, unknown[]>()

  const failIfAsked = (method: string) => {
    const queued = failures.get(method)
    if (queued && queued.length > 0) throw queued.shift()
  }

  const record = (
    subscriptionId: string,
    metadata: Partial<Pick<SubscriptionState, 'requestedBy' | 'receiptFor'>>,
  ) => {
    const held = subscriptions.get(subscriptionId)
    if (held) subscriptions.set(subscriptionId, { ...held, ...metadata })
  }

  const updateSnapshot = (
    subscriptionId: string,
    change: (subscription: NonNullable<BillingSnapshot['subscription']>) => void,
  ) => {
    const held = subscriptions.get(subscriptionId)
    const snapshot = held && customers.get(held.customerId)
    if (snapshot?.subscription) change(snapshot.subscription)
  }

  const priceOf = ({ plan, cycle }: PaidSubscription) => ({
    amount: cycle === 'yearly' ? PLAN_OFFERS[plan].yearlyCents : PLAN_OFFERS[plan].monthlyCents,
    currency: 'usd',
  })

  const subscribe = (state: FakeSubscription) => {
    subscriptions.set(state.id, {
      requestedBy: null,
      receiptFor: null,
      cancellationReason: null,
      ...state,
      anchor: state.anchor ? new Date(state.anchor) : new Date(),
    })
  }

  const bill = (customerId: string, snapshot: BillingSnapshot) => {
    customers.set(customerId, structuredClone(snapshot))
  }

  return {
    publishableKey: 'pk_test_fake',
    checkouts,
    topUps,
    topUpPayments,
    changes,
    cancellations,
    ended,
    portals,
    subscriptions,
    customers,
    subscribe,
    bill,
    failNext(method, error) {
      failures.set(method, [...(failures.get(method) ?? []), error])
    },

    async checkout(request) {
      failIfAsked('checkout')
      checkouts.push(request)
      return { clientSecret: `cs_test_${checkouts.length}_secret` }
    },
    async topUpCheckout(request) {
      failIfAsked('topUpCheckout')
      topUps.push(request)
      return { url: `https://checkout.stripe.test/c/pay/cs_test_top_up_${topUps.length}` }
    },
    async topUpPayment(paymentIntentId) {
      failIfAsked('topUpPayment')
      return topUpPayments.get(paymentIntentId) ?? null
    },
    event(rawBody, signature) {
      if (signature !== FAKE_STRIPE_SIGNATURE) throw new Error('No signatures found matching')
      const body = JSON.parse(rawBody) as FakeWebhookBody
      const { subscribe: state, bill: billing, ...event } = body
      if (state) subscribe(state)
      if (billing) bill(billing.customerId, billing.snapshot)
      if (event.kind && event.kind !== 'subscription') return event as BillingEvent
      const subscription = event as Partial<SubscriptionEvent>
      if (subscription.subscriptionId === undefined) return null
      return {
        kind: 'subscription',
        subscriptionId: subscription.subscriptionId,
        organizationId: subscription.organizationId ?? null,
        previousLookupKey: subscription.previousLookupKey ?? null,
      }
    },
    async subscription(id) {
      failIfAsked('subscription')
      const subscription = subscriptions.get(id)
      if (!subscription) throw new Error(`No such subscription: '${id}'`)
      return { ...subscription }
    },
    async billing(customerId) {
      failIfAsked('billing')
      const snapshot = customers.get(customerId)
      if (!snapshot) throw new Error(`No such customer: '${customerId}'`)
      return structuredClone(snapshot)
    },
    async price(choice) {
      failIfAsked('price')
      return priceOf(choice)
    },
    async previewNow() {
      failIfAsked('previewNow')
      return { ...FAKE_PRORATION }
    },
    async changeNow(subscriptionId, choice, requestedBy) {
      failIfAsked('changeNow')
      changes.push({ subscriptionId, choice, when: 'now' })
      record(subscriptionId, { requestedBy })
      const key = `${choice.plan}_${choice.cycle}`
      const held = subscriptions.get(subscriptionId)
      if (held) subscriptions.set(subscriptionId, { ...held, lookupKey: key })
      updateSnapshot(subscriptionId, (subscription) => {
        subscription.lookupKey = key
        subscription.amount = priceOf(choice)
        subscription.scheduled = null
        subscription.cancelAtPeriodEnd = false
      })
    },
    async changeAtRenewal(subscriptionId, choice, requestedBy) {
      failIfAsked('changeAtRenewal')
      changes.push({ subscriptionId, choice, when: 'renewal' })
      record(subscriptionId, { requestedBy })
      updateSnapshot(subscriptionId, (subscription) => {
        subscription.scheduled = {
          lookupKey: `${choice.plan}_${choice.cycle}`,
          at: subscription.periodEnd,
          amount: priceOf(choice),
        }
        subscription.cancelAtPeriodEnd = false
      })
    },
    async markReceipted(subscriptionId, key) {
      failIfAsked('markReceipted')
      record(subscriptionId, { receiptFor: key })
    },
    async cancelAtPeriodEnd(subscriptionId, cancel) {
      failIfAsked('cancelAtPeriodEnd')
      cancellations.push({ subscriptionId, cancel })
      updateSnapshot(subscriptionId, (subscription) => {
        subscription.cancelAtPeriodEnd = cancel
        if (cancel) subscription.scheduled = null
      })
    },
    async endNow(subscriptionId) {
      failIfAsked('endNow')
      ended.push(subscriptionId)
    },
    async portal(customerId, returnUrl, to) {
      failIfAsked('portal')
      portals.push({ customerId, returnUrl, to })
      return `https://billing.stripe.test/p/session_${portals.length}`
    },
  }
}
