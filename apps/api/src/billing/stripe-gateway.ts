import type { ApiEnv } from '../env'
import { fakeStripe } from '../testing/fake-stripe'
import { realStripeGateway } from './real-stripe'
import type { PaidSubscription } from './subscription-plan'

export type { PaidSubscription } from './subscription-plan'

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
  requestedBy: string | null
  receiptFor: string | null
  cancellationReason: string | null
  status: string
  lookupKey: string | null
  anchor: Date
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
    card: { brand: string; last4: string } | null
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
  | {
      kind: 'subscription'
      subscriptionId: string | null
      organizationId: string | null
      previousLookupKey?: string | null
    }
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
  | {
      kind: 'invoice-paid'
      subscriptionId: string
      invoiceId: string
      amount: Money
      pdfUrl: string | null
    }

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
  billing(customerId: string, subscriptionId: string | null): Promise<BillingSnapshot>
  price(choice: PaidSubscription): Promise<Money>
  previewNow(subscriptionId: string, choice: PaidSubscription): Promise<Money>
  changeNow(subscriptionId: string, choice: PaidSubscription, requestedBy: string): Promise<void>
  changeAtRenewal(
    subscriptionId: string,
    choice: PaidSubscription,
    requestedBy: string,
  ): Promise<void>
  markReceipted(subscriptionId: string, planKey: string): Promise<void>
  cancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<void>
  endNow(subscriptionId: string): Promise<void>
  portal(customerId: string, returnUrl: string, to: PortalTarget): Promise<string>
}

export function createStripeGateway(env: ApiEnv): StripeGateway | null {
  if (env.STRIPE_FAKE === '1') return fakeStripe()
  const { STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET } = env
  if (!STRIPE_SECRET_KEY || !STRIPE_PUBLISHABLE_KEY || !STRIPE_WEBHOOK_SECRET) return null
  return realStripeGateway({
    secretKey: STRIPE_SECRET_KEY,
    publishableKey: STRIPE_PUBLISHABLE_KEY,
    webhookSecret: STRIPE_WEBHOOK_SECRET,
  })
}
