import { ORPCError } from '@orpc/server'

import type { ApiEnv } from '../env'
import type { Logger } from '../observability/logger'
import { PAYMENT_REQUIRED_STATUS } from '../orpc/context'
import { fakeStripe } from '../testing/fake-stripe'
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
  itemId: string | null
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
  previewNow(subscription: SubscriptionState, choice: PaidSubscription): Promise<Money>
  changeNow(subscription: SubscriptionState, choice: PaidSubscription): Promise<SubscriptionState>
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

/** Without Stripe keys: every call answers 503 and every webhook is refused. */
export function unconfiguredStripe(): StripeGateway {
  const refuse = () => Promise.reject(new ORPCError('SERVICE_UNAVAILABLE', { message: NOT_SET_UP }))
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

const isCardError = (err: unknown) => (err as { type?: string } | null)?.type === 'StripeCardError'

type StripeCall = Exclude<keyof StripeGateway, 'publishableKey' | 'event'>

const STRIPE_CALLS: Record<StripeCall, true> = {
  checkout: true,
  topUpCheckout: true,
  topUpPayment: true,
  subscription: true,
  customer: true,
  billing: true,
  price: true,
  previewNow: true,
  changeNow: true,
  changeAtRenewal: true,
  cancelAtPeriodEnd: true,
  endNow: true,
  portal: true,
}

/**
 * Every call that reaches Stripe, logged when it fails and answered as one oRPC error: 402 for a
 * declined card, 502 for anything else. `event` is left as is (the webhook answers 401).
 */
export function guardedStripe(gateway: StripeGateway, log: Logger): StripeGateway {
  const guard = async (operation: StripeCall, args: unknown[]) => {
    try {
      return await (gateway[operation] as (...args: unknown[]) => Promise<unknown>)(...args)
    } catch (err) {
      if (err instanceof ORPCError) throw err
      log.error({ err, operation }, 'Stripe call failed')
      if (isCardError(err)) {
        throw new ORPCError('PAYMENT_REQUIRED', {
          status: PAYMENT_REQUIRED_STATUS,
          message: CARD_DECLINED,
        })
      }
      throw new ORPCError('BAD_GATEWAY', { message: STRIPE_UNREACHABLE })
    }
  }
  const calls = Object.fromEntries(
    (Object.keys(STRIPE_CALLS) as StripeCall[]).map((operation) => [
      operation,
      (...args: unknown[]) => guard(operation, args),
    ]),
  )
  return {
    ...calls,
    publishableKey: gateway.publishableKey,
    event: (rawBody, signature) => gateway.event(rawBody, signature),
  } as StripeGateway
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
