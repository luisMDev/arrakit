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
} from './stripe-gateway'
import type { PaidSubscription } from './subscription-plan'

export const FAKE_STRIPE_SIGNATURE = 't=1,v1=fake-stripe-signature'
export const FAKE_PRORATION = { amount: 120_000, currency: 'usd' } as const

interface FakeChange {
  subscriptionId: string
  choice: PaidSubscription
  when: 'now' | 'renewal'
}

type OptionalState = 'cancellationReason' | 'periodEnd' | 'itemId' | 'scheduleId'
type FakeSubscription = Omit<SubscriptionState, OptionalState | 'anchor'> &
  Partial<Pick<SubscriptionState, OptionalState>> & { anchor?: Date | string }

const MONTH_SECONDS = 30 * 24 * 60 * 60

/**
 * A webhook body for the fake: a BillingEvent as JSON (kind `subscription` when left out).
 * `subscribe` and `bill` let a dev or e2e run put state into the fake with the same delivery.
 */
type FakeWebhookBody = Partial<BillingEvent> & {
  subscribe?: FakeSubscription
  bill?: { customerId: string; snapshot: BillingSnapshot }
}

export type FakeStripe = ReturnType<typeof fakeStripe>

export function fakeStripe() {
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
      cancellationReason: null,
      periodEnd: Math.floor(Date.now() / 1000) + MONTH_SECONDS,
      itemId: `si_${state.id}`,
      scheduleId: null,
      ...state,
      anchor: state.anchor ? new Date(state.anchor) : new Date(),
    })
  }

  const bill = (customerId: string, snapshot: BillingSnapshot) => {
    customers.set(customerId, structuredClone(snapshot))
  }

  const gateway = {
    publishableKey: 'pk_test_fake',
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
      }
    },
    async subscription(id) {
      failIfAsked('subscription')
      const subscription = subscriptions.get(id)
      if (!subscription) throw new Error(`No such subscription: '${id}'`)
      return { ...subscription }
    },
    async customer(id) {
      failIfAsked('customer')
      const snapshot = customers.get(id)
      if (!snapshot) throw new Error(`No such customer: '${id}'`)
      return { email: snapshot.customer?.email ?? null, card: snapshot.customer?.card ?? null }
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
    async changeNow(subscription, choice) {
      failIfAsked('changeNow')
      changes.push({ subscriptionId: subscription.id, choice, when: 'now' })
      const lookupKey = `${choice.plan}_${choice.cycle}`
      const changed = { ...(subscriptions.get(subscription.id) ?? subscription), lookupKey }
      subscriptions.set(subscription.id, changed)
      updateSnapshot(subscription.id, (snapshot) => {
        snapshot.lookupKey = lookupKey
        snapshot.amount = priceOf(choice)
        snapshot.scheduled = null
        snapshot.cancelAtPeriodEnd = false
      })
      return { ...changed }
    },
    async changeAtRenewal(subscription, choice) {
      failIfAsked('changeAtRenewal')
      changes.push({ subscriptionId: subscription.id, choice, when: 'renewal' })
      updateSnapshot(subscription.id, (snapshot) => {
        snapshot.scheduled = {
          lookupKey: `${choice.plan}_${choice.cycle}`,
          at: snapshot.periodEnd,
          amount: priceOf(choice),
        }
        snapshot.cancelAtPeriodEnd = false
      })
      return { ...(subscriptions.get(subscription.id) ?? subscription) }
    },
    async cancelAtPeriodEnd(subscription, cancel) {
      failIfAsked('cancelAtPeriodEnd')
      cancellations.push({ subscriptionId: subscription.id, cancel })
      updateSnapshot(subscription.id, (snapshot) => {
        snapshot.cancelAtPeriodEnd = cancel
        if (cancel) snapshot.scheduled = null
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
  } satisfies StripeGateway

  return {
    ...gateway,
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
    /** Makes the next calls of `method` throw `error` (once each, in order). */
    failNext(method: keyof StripeGateway, error: unknown) {
      failures.set(method, [...(failures.get(method) ?? []), error])
    },
  }
}
