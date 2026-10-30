import type { ScopedData } from '@arrakit/db'
import type { Mail, Mailer } from '@arrakit/emails'
import { PLAN_LABELS } from '@arrakit/plans'

import {
  type BillingOutcome,
  applyBillingEvent,
  findOrganization,
  findSubscriptionOrganization,
} from './apply-billing-event'
import {
  adminsOf,
  chargeOf,
  cycleReceiptDue,
  daysUntil,
  downgradeDue,
  downgradedMails,
  failedMails,
  receiptMails,
  recipients,
  renewMails,
  shouldSendReceipt,
} from './billing-mail'
import { dayOf } from './billing-view'
import type { BillingEvent, StripeGateway, SubscriptionEvent } from './stripe-gateway'
import { subscriptionOfLookupKey } from './subscription-plan'

type MailKind = 'receipt' | 'failed payment' | 'renewal' | 'downgraded'
type Applied = Extract<BillingOutcome, { kind: 'applied' }>
type EventOf<K extends BillingEvent['kind']> = Extract<BillingEvent, { kind: K }>

export interface SettleDeps {
  data: ScopedData
  stripe: StripeGateway
  mailer: Mailer
  webUrl: string
  now?: () => number
}

export function settleBillingEvent(deps: SettleDeps, event: BillingEvent): Promise<void> {
  const { data, stripe, mailer, webUrl } = deps
  const now = deps.now ?? Date.now
  const billingLink = `${webUrl}/app/billing`

  const ignored = (reason: string) => console.warn(`[billing] ignored event: ${reason}`)

  const notSent = (organizationId: string, kind: MailKind, err: unknown) =>
    console.error(
      `[billing] organization ${organizationId}: ${kind} email not sent`,
      err instanceof Error ? err.stack : String(err),
    )

  async function sendAll(organizationId: string, kind: MailKind, mails: Mail[]) {
    for (const mail of mails) {
      try {
        await mailer.send(mail)
      } catch (err) {
        notSent(organizationId, kind, err)
      }
    }
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
      console.info(`[billing] organization ${found.organizationId} topped up ${topUp.cents} cents`)
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
      console.info(
        `[billing] organization ${found.organizationId}: ${cents} cents of top-up taken back (${reversal.reversalId})`,
      )
    }
  }

  async function settleRenewal(upcoming: EventOf<'invoice-upcoming'>) {
    const found = await findSubscriptionOrganization(data, stripe, upcoming.subscriptionId)
    if (found.kind === 'ignored') return ignored(found.reason)
    const { organizationId, organization, subscription } = found
    const paid = subscriptionOfLookupKey(subscription.lookupKey)
    if (paid?.cycle !== 'yearly') return
    const billing = await stripe.billing(subscription.customerId, subscription.id)
    if (!billing.subscription) {
      throw new Error(`subscription ${subscription.id} has no period to show`)
    }
    const { periodEnd } = billing.subscription
    const to = recipients(billing.customer?.email)
    if (to.length === 0) {
      return notSent(
        organizationId,
        'renewal',
        new Error(`subscription ${subscription.id} has no billing email`),
      )
    }
    await sendAll(
      organizationId,
      'renewal',
      renewMails({
        organization,
        plan: PLAN_LABELS[paid.plan],
        charge: chargeOf(upcoming.amount, billing.customer?.card ?? null),
        renewsOn: dayOf(periodEnd),
        daysLeft: daysUntil(periodEnd, now()),
        to,
        webOrigin: webUrl,
      }),
    )
  }

  async function settleCycleReceipt(invoice: EventOf<'invoice-paid'>) {
    const found = await findSubscriptionOrganization(data, stripe, invoice.subscriptionId)
    if (found.kind === 'ignored') return ignored(found.reason)
    const { organizationId, organization, subscription } = found
    const { lookupKey } = subscription
    const paid = subscriptionOfLookupKey(lookupKey)
    if (!lookupKey || !paid || !cycleReceiptDue({ lookupKey, receiptFor: subscription.receiptFor }))
      return
    const billing = await stripe.billing(subscription.customerId, subscription.id)
    if (!billing.subscription) {
      throw new Error(`subscription ${subscription.id} has no period to show`)
    }
    const mails = receiptMails({
      organization,
      plan: PLAN_LABELS[paid.plan],
      cycle: paid.cycle,
      charge: chargeOf(invoice.amount, billing.customer?.card ?? null),
      renewsOn: dayOf(billing.subscription.periodEnd),
      invoiceUrl: invoice.pdfUrl ?? billingLink,
      to: recipients(subscription.requestedBy, billing.customer?.email),
      webOrigin: webUrl,
    })
    await stripe.markReceipted(subscription.id, lookupKey)
    await sendAll(organizationId, 'receipt', mails)
  }

  async function settleFailed(failed: EventOf<'invoice-failed'>) {
    if (failed.nextAttempt === null) return
    const found = await findSubscriptionOrganization(data, stripe, failed.subscriptionId)
    if (found.kind === 'ignored') return ignored(found.reason)
    const { organizationId, organization, scope, subscription } = found
    const [billing, members] = await Promise.all([
      stripe.billing(subscription.customerId, subscription.id),
      scope.members.list(),
    ])
    await sendAll(
      organizationId,
      'failed payment',
      failedMails({
        organization,
        charge: chargeOf(failed.amount, billing.customer?.card ?? null),
        retryInDays: daysUntil(failed.nextAttempt, now()),
        to: recipients(billing.customer?.email, ...adminsOf(members)),
        webOrigin: webUrl,
      }),
    )
  }

  async function settleReceipt(outcome: Applied, event: SubscriptionEvent) {
    const { subscription } = outcome
    const { lookupKey } = subscription
    const paid = subscriptionOfLookupKey(lookupKey)
    if (!lookupKey || !paid || outcome.plan === 'free' || subscription.receiptFor === lookupKey) {
      return
    }
    const previousLookupKey = event.previousLookupKey ?? null
    if (previousLookupKey && cycleReceiptDue({ lookupKey, receiptFor: previousLookupKey })) {
      await stripe.markReceipted(subscription.id, previousLookupKey)
      return
    }
    const due = shouldSendReceipt({
      previousLookupKey,
      previousPlan: outcome.previousPlan,
      plan: outcome.plan,
      lookupKey,
      receiptFor: subscription.receiptFor,
    })
    if (due) {
      const billing = await stripe.billing(subscription.customerId, subscription.id)
      const invoice = billing.invoices.find((shown) => shown.status === 'paid')
      if (!invoice || !billing.subscription) {
        throw new Error(`subscription ${subscription.id} has no paid invoice or period to show`)
      }
      const to = recipients(subscription.requestedBy, billing.customer?.email)
      if (to.length === 0) {
        throw new Error(`subscription ${subscription.id} has no address to send to`)
      }
      await sendAll(
        outcome.organizationId,
        'receipt',
        receiptMails({
          organization: outcome.organization,
          plan: PLAN_LABELS[paid.plan],
          cycle: paid.cycle,
          charge: chargeOf(invoice.total, billing.customer?.card ?? null),
          renewsOn: dayOf(billing.subscription.periodEnd),
          invoiceUrl: invoice.pdfUrl ?? billingLink,
          to,
          webOrigin: webUrl,
        }),
      )
    }
    if (due || previousLookupKey) await stripe.markReceipted(subscription.id, lookupKey)
  }

  async function settleDowngrade(outcome: Applied) {
    const { subscription, previousPlan, plan } = outcome
    if (!downgradeDue({ previousPlan, plan, cancellationReason: subscription.cancellationReason }))
      return
    const [billing, members] = await Promise.all([
      stripe.billing(subscription.customerId, null),
      data.forOrganization(outcome.organizationId).members.list(),
    ])
    await sendAll(
      outcome.organizationId,
      'downgraded',
      downgradedMails({
        organization: outcome.organization,
        plan: PLAN_LABELS[previousPlan],
        to: recipients(billing.customer?.email, ...adminsOf(members)),
        webOrigin: webUrl,
      }),
    )
  }

  async function settleSubscription(event: SubscriptionEvent) {
    const outcome = await applyBillingEvent(data, stripe, event)
    if (outcome.kind === 'ignored') return ignored(outcome.reason)
    console.info(`[billing] organization ${outcome.organizationId} is on ${outcome.plan}`)
    try {
      await settleReceipt(outcome, event)
    } catch (err) {
      notSent(outcome.organizationId, 'receipt', err)
    }
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
      return settleCycleReceipt(event)
    case 'invoice-failed':
      return settleFailed(event)
    case 'subscription':
      return settleSubscription(event)
  }
}
