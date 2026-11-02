import { ORPCError } from '@orpc/server'

import type { ApiEnv } from '../env'
import type { Logger } from '../observability/logger'
import { PAYMENT_REQUIRED_STATUS } from '../orpc/context'
import { fakeStripe } from './fake-stripe'
import { realStripeGateway } from './real-stripe'
import type { PaidSubscription } from './subscription-plan'

export interface Money {
  /** Minor unit. */
  amount: number
  /** Lowercase ISO 4217. */
  currency: string
}

export interface CheckoutRequest extends PaidSubscription {
  organizationId: string
  customerId: string | null
  email: string
  returnUrl: string
}

export interface TopUpRequest {
  organizationId: string
  cents: number
  customerId: string | null
  email: string
  successUrl: string
  cancelUrl: string
}

export interface SubscriptionState {
  id: string
  customerId: string
  organizationId: string | null
  cancellationReason: string | null
  status: string
  lookupKey: string | null
  anchor: Date
  /** Unix seconds. */
  periodEnd: number
  itemId: string
  scheduleId: string | null
}

export interface Card {
  brand: string
  last4: string
}

export interface SubscriptionSnapshot {
  status: string
  lookupKey: string | null
  /** Unix seconds. */
  periodEnd: number
  cancelAtPeriodEnd: boolean
  amount: Money | null
  scheduled: { lookupKey: string | null; at: number; amount: Money | null } | null
}

export interface BillingSnapshot {
  subscription: SubscriptionSnapshot | null
  customer: {
    email: string | null
    name: string | null
    taxId: string | null
    card: Card | null
  } | null
  /** Newest first. */
  invoices: {
    id: string
    created: number
    total: Money
    status: 'paid' | 'open' | 'uncollectible'
    pdfUrl: string | null
  }[]
}

export type BillingEvent =
  | { kind: 'subscription'; subscriptionId: string | null; organizationId: string | null }
  | {
      kind: 'top-up'
      sessionId: string
      organizationId: string | null
      customerId: string | null
      cents: number
      paid: boolean
    }
  | { kind: 'payment-reversed'; reversalId: string; paymentIntentId: string; amount: number }
  | { kind: 'invoice-upcoming'; subscriptionId: string; amount: Money }
  | { kind: 'invoice-failed'; subscriptionId: string; amount: Money; nextAttempt: number | null }
  | { kind: 'invoice-paid'; subscriptionId: string; amount: Money; invoiceUrl: string | null }

export type SubscriptionEvent = Extract<BillingEvent, { kind: 'subscription' }>

export type PortalTarget = 'payment' | 'details'

export interface StripeGateway {
  readonly publishableKey: string
  checkout(req: CheckoutRequest): Promise<{ clientSecret: string }>
  topUpCheckout(req: TopUpRequest): Promise<{ url: string }>
  topUpPayment(
    paymentIntentId: string,
  ): Promise<{ organizationId: string; cents: number; total: number } | null>
  /** Throws on a bad signature; null for an ignored event. */
  event(rawBody: string, signature: string): BillingEvent | null
  subscription(id: string): Promise<SubscriptionState>
  customer(id: string): Promise<{ email: string | null; card: Card | null }>
  billing(customerId: string, subscriptionId: string | null): Promise<BillingSnapshot>
  price(choice: PaidSubscription): Promise<Money>
  /** `prorationDate` in Unix seconds: `changeNow` given the same date charges what this answers. */
  previewNow(
    subscription: SubscriptionState,
    choice: PaidSubscription,
    prorationDate: number,
  ): Promise<Money>
  changeNow(
    subscription: SubscriptionState,
    choice: PaidSubscription,
    prorationDate: number,
  ): Promise<SubscriptionState>
  changeAtRenewal(
    subscription: SubscriptionState,
    choice: PaidSubscription,
  ): Promise<SubscriptionState>
  cancelAtPeriodEnd(subscription: SubscriptionState, cancel: boolean): Promise<void>
  endNow(subscriptionId: string): Promise<void>
  portal(customerId: string, returnUrl: string, to: PortalTarget): Promise<string>
}

export const STRIPE_UNREACHABLE = "Couldn't reach Stripe. Try again in a minute."
const CARD_DECLINED = 'Your card was declined. Update it under Payment, then try again.'
const NOT_SET_UP = 'Payments are not set up yet.'

class StripeNotSetUp extends Error {}

/** Without Stripe keys: every call answers 503 and every webhook is refused. */
export function unconfiguredStripe(): StripeGateway {
  const refuse = () => Promise.reject(new StripeNotSetUp(NOT_SET_UP))
  return {
    publishableKey: '',
    checkout: refuse,
    topUpCheckout: refuse,
    topUpPayment: refuse,
    event() {
      throw new Error('Stripe is not set up')
    },
    subscription: refuse,
    customer: refuse,
    billing: refuse,
    price: refuse,
    previewNow: refuse,
    changeNow: refuse,
    changeAtRenewal: refuse,
    cancelAtPeriodEnd: refuse,
    endNow: refuse,
    portal: refuse,
  }
}

export type StripeFailure = 'PAYMENT_REQUIRED' | 'BAD_GATEWAY' | 'SERVICE_UNAVAILABLE'

/** Builds the error a refused Stripe call surfaces as. */
export type StripeRefusal = (code: StripeFailure, message: string) => Error

const orpcRefusal: StripeRefusal = (code, message) =>
  new ORPCError(code, {
    status: code === 'PAYMENT_REQUIRED' ? PAYMENT_REQUIRED_STATUS : undefined,
    message,
  })

const isCardError = (err: unknown) => (err as { type?: string } | null)?.type === 'StripeCardError'

/**
 * Every call that reaches Stripe, logged when it fails and answered as one error built by
 * `refuse`: 402 for a declined card, 503 when Stripe is not set up, 502 for anything else.
 * `event` is left as is (the webhook answers 401).
 */
export function guardedStripe(
  gateway: StripeGateway,
  log: Logger,
  refuse: StripeRefusal = orpcRefusal,
): StripeGateway {
  const guard =
    (operation: string, call: (...args: unknown[]) => Promise<unknown>) =>
    async (...args: unknown[]) => {
      try {
        return await call(...args)
      } catch (err) {
        if (err instanceof StripeNotSetUp) throw refuse('SERVICE_UNAVAILABLE', err.message)
        log.error({ err, operation }, 'Stripe call failed')
        if (isCardError(err)) throw refuse('PAYMENT_REQUIRED', CARD_DECLINED)
        throw refuse('BAD_GATEWAY', STRIPE_UNREACHABLE)
      }
    }
  return Object.fromEntries(
    Object.entries(gateway).map(([operation, value]) => [
      operation,
      typeof value === 'function' && operation !== 'event' ? guard(operation, value) : value,
    ]),
  ) as StripeGateway
}

export function createStripeGateway(env: ApiEnv): StripeGateway {
  if (env.STRIPE_FAKE === '1') return fakeStripe()
  const { STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET } = env
  if (!STRIPE_SECRET_KEY || !STRIPE_PUBLISHABLE_KEY || !STRIPE_WEBHOOK_SECRET) {
    return unconfiguredStripe()
  }
  return realStripeGateway({
    secretKey: STRIPE_SECRET_KEY,
    publishableKey: STRIPE_PUBLISHABLE_KEY,
    webhookSecret: STRIPE_WEBHOOK_SECRET,
  })
}
