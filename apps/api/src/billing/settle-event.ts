import type { ScopedData } from '@arrakit/db'
import {
  type Mailer,
  type RenderedEmail,
  downgradedEmail,
  failedEmail,
  receiptEmail,
  renewEmail,
} from '@arrakit/emails'
import { PLAN_LABELS } from '@arrakit/plans'

import { dayOf } from '../day'
import type { Logger } from '../observability/logger'
import {
  type BillingOutcome,
  applyBillingEvent,
  findOrganization,
  findSubscriptionOrganization,
} from './apply-billing-event'
import {
  adminsOf,
  billingLink,
  chargeOf,
  daysUntil,
  downgradeDue,
  mailsOf,
  recipients,
  sendMails,
} from './billing-mail'
import type { BillingEvent, StripeGateway, SubscriptionEvent } from './stripe-gateway'
import { subscriptionOfLookupKey } from './subscription-plan'

type MailKind = 'receipt' | 'failed payment' | 'renewal' | 'downgraded'
type Applied = Extract<BillingOutcome, { kind: 'applied' }>
type EventOf<K extends BillingEvent['kind']> = Extract<BillingEvent, { kind: K }>

interface SettleDeps {
  data: ScopedData
  stripe: StripeGateway
  mailer: Mailer
  webUrl: string
  log: Logger
  now?: () => number
}

export function settleBillingEvent(deps: SettleDeps, event: BillingEvent): Promise<void> {
  const { data, stripe, mailer, webUrl, log } = deps
  const now = deps.now ?? Date.now
  const links = { billing: billingLink(webUrl) }

  const ignored = (reason: string) => log.warn({ reason }, 'billing event ignored')

  const notSent = (organizationId: string, kind: MailKind, err: unknown) =>
    log.error({ err, organizationId, mail: kind }, 'billing email not sent')

  async function send(organizationId: string, kind: MailKind, email: RenderedEmail, to: string[]) {
    if (to.length === 0) return notSent(organizationId, kind, new Error('no address to send to'))
    await sendMails(mailer, mailsOf(email, to), (err) => notSent(organizationId, kind, err))
  }

  async function settleTopUp(topUp: EventOf<'top-up'>) {
    if (!topUp.paid) return
    const found = await findOrganization(data, topUp.organizationId, `top-up ${topUp.sessionId}`)
    if (found.kind === 'ignored') return ignored(found.reason)
    const credited = await found.scope.usage.credit(topUp.cents, {
      idempotencyKey: `checkout:${topUp.sessionId}`,
    })
    if (topUp.customerId) await found.scope.setStripeCustomer(topUp.customerId)
    if (credited) {
      log.info({ organizationId: found.organizationId, cents: topUp.cents }, 'credits topped up')
    }
  }

  async function settleReversal(reversal: EventOf<'payment-reversed'>) {
    const topUp = await stripe.topUpPayment(reversal.paymentIntentId)
    if (!topUp) return
    const found = await findOrganization(
      data,
      topUp.organizationId,
      `top-up ${reversal.paymentIntentId}`,
    )
    if (found.kind === 'ignored') return ignored(found.reason)
    const cents = Math.min(
      topUp.cents,
      Math.round((reversal.amount * topUp.cents) / Math.max(topUp.total, 1)),
    )
    if (cents === 0) return
    const reversed = await found.scope.usage.reverse(cents, {
      idempotencyKey: `reversal:${reversal.reversalId}`,
      payment: { key: reversal.paymentIntentId, cents: topUp.cents },
    })
    if (reversed) {
      log.info(
        { organizationId: found.organizationId, cents, reversalId: reversal.reversalId },
        'top-up taken back',
      )
    }
  }

  async function settleRenewal(upcoming: EventOf<'invoice-upcoming'>) {
    const found = await findSubscriptionOrganization(data, stripe, upcoming.subscriptionId)
    if (found.kind === 'ignored') return ignored(found.reason)
    const { organizationId, subscription } = found
    const paid = subscriptionOfLookupKey(subscription.lookupKey)
    if (paid?.cycle !== 'yearly') return
    const customer = await stripe.customer(subscription.customerId)
    const email = renewEmail({
      plan: PLAN_LABELS[paid.plan],
      charge: chargeOf(upcoming.amount, customer.card),
      renewsOn: dayOf(subscription.periodEnd),
      daysLeft: daysUntil(subscription.periodEnd, now()),
      links,
    })
    await send(organizationId, 'renewal', email, recipients(customer.email))
  }

  async function settleReceipt(invoice: EventOf<'invoice-paid'>) {
    if (invoice.amount.amount === 0) return
    const found = await findSubscriptionOrganization(data, stripe, invoice.subscriptionId)
    if (found.kind === 'ignored') return ignored(found.reason)
    const { organizationId, subscription } = found
    const paid = subscriptionOfLookupKey(subscription.lookupKey)
    if (!paid) return ignored(`subscription ${subscription.id} bills no known price`)
    const customer = await stripe.customer(subscription.customerId)
    const email = receiptEmail({
      plan: PLAN_LABELS[paid.plan],
      billing: paid.cycle,
      charge: chargeOf(invoice.amount, customer.card),
      renewsOn: dayOf(subscription.periodEnd),
      links: { ...links, invoice: invoice.invoiceUrl ?? links.billing },
    })
    await send(organizationId, 'receipt', email, recipients(customer.email))
  }

  async function settleFailed(failed: EventOf<'invoice-failed'>) {
    if (failed.nextAttempt === null) return
    const found = await findSubscriptionOrganization(data, stripe, failed.subscriptionId)
    if (found.kind === 'ignored') return ignored(found.reason)
    const { organizationId, scope, subscription } = found
    const [customer, members] = await Promise.all([
      stripe.customer(subscription.customerId),
      scope.members.list(),
    ])
    const email = failedEmail({
      charge: chargeOf(failed.amount, customer.card),
      retryInDays: daysUntil(failed.nextAttempt, now()),
      links,
    })
    await send(
      organizationId,
      'failed payment',
      email,
      recipients(customer.email, ...adminsOf(members)),
    )
  }

  async function settleDowngrade(outcome: Applied) {
    const { subscription, previousPlan, plan } = outcome
    if (!downgradeDue({ previousPlan, plan, cancellationReason: subscription.cancellationReason }))
      return
    const [customer, members] = await Promise.all([
      stripe.customer(subscription.customerId),
      data.forOrganization(outcome.organizationId).members.list(),
    ])
    const email = downgradedEmail({
      organization: outcome.organization.name,
      plan: PLAN_LABELS[previousPlan],
      links,
    })
    await send(
      outcome.organizationId,
      'downgraded',
      email,
      recipients(customer.email, ...adminsOf(members)),
    )
  }

  async function settleSubscription(event: SubscriptionEvent) {
    const outcome = await applyBillingEvent(data, stripe, event)
    if (outcome.kind === 'ignored') return ignored(outcome.reason)
    log.info({ organizationId: outcome.organizationId, plan: outcome.plan }, 'plan updated')
    try {
      await settleDowngrade(outcome)
    } catch (err) {
      notSent(outcome.organizationId, 'downgraded', err)
    }
  }

  switch (event.kind) {
    case 'top-up':
      return settleTopUp(event)
    case 'payment-reversed':
      return settleReversal(event)
    case 'invoice-upcoming':
      return settleRenewal(event)
    case 'invoice-paid':
      return settleReceipt(event)
    case 'invoice-failed':
      return settleFailed(event)
    case 'subscription':
      return settleSubscription(event)
  }
}
