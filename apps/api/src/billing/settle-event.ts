import type { OrganizationRow, OrganizationScope, ScopedData, StripeRefs } from '@arrakit/db'
import {
  type RenderedEmail,
  daysUntil,
  downgradedEmail,
  failedEmail,
  receiptEmail,
  renewEmail,
} from '@arrakit/emails'
import { PLAN_LABELS, type Plan } from '@arrakit/plans'

import { dayOf } from '../day'
import type { AppDeps } from '../deps'
import type { Logger } from '../observability/logger'
import {
  adminsOf,
  billingLink,
  chargeOf,
  downgradeDue,
  recipients,
  sendMails,
} from './billing-mail'
import type {
  BillingEvent,
  StripeGateway,
  SubscriptionEvent,
  SubscriptionState,
} from './stripe-gateway'
import { planOfSubscription, subscriptionOfLookupKey } from './subscription-plan'

interface FoundOrganization {
  scope: OrganizationScope
  organization: OrganizationRow
}

type SubscriptionOrganization = FoundOrganization & { subscription: SubscriptionState }

interface AppliedPlan {
  organization: OrganizationRow
  plan: Plan
  subscription: SubscriptionState
}

type Organizations = Pick<ScopedData, 'asSystem'>

export const stripeRefs = (subscription: SubscriptionState, plan: Plan): StripeRefs => ({
  customerId: subscription.customerId,
  subscriptionId: plan === 'free' ? null : subscription.id,
  anchor: subscription.anchor,
})

const ignored = (log: Logger, reason: string) => {
  log.warn({ reason }, 'billing event ignored')
  return null
}

async function findOrganization(
  data: Organizations,
  log: Logger,
  organizationId: string | null,
  what: string,
): Promise<FoundOrganization | null> {
  if (!organizationId) return ignored(log, `${what} names no organization`)
  let scope: OrganizationScope
  try {
    scope = data.asSystem(organizationId)
  } catch {
    return ignored(log, `${what} names no organization id`)
  }
  const organization = await scope.organization()
  if (!organization) return ignored(log, `organization ${organizationId} is gone`)
  return { scope, organization }
}

async function findSubscriptionOrganization(
  data: Organizations,
  stripe: Pick<StripeGateway, 'subscription'>,
  log: Logger,
  subscriptionId: string | null,
  eventOrganizationId: string | null = null,
): Promise<SubscriptionOrganization | null> {
  if (!subscriptionId) return ignored(log, 'no subscription')
  const subscription = await stripe.subscription(subscriptionId)
  const organizationId = subscription.organizationId ?? eventOrganizationId
  const found = await findOrganization(data, log, organizationId, `subscription ${subscription.id}`)
  return found && { ...found, subscription }
}

async function isLive(stripe: Pick<StripeGateway, 'subscription'>, subscriptionId: string) {
  const subscription = await stripe.subscription(subscriptionId)
  return planOfSubscription(subscription.status, subscription.lookupKey) !== 'free'
}

/**
 * The subscription an organization already pays with wins: a second live one (two Checkouts
 * paid while the organization was on Free) is ended at once, so only one keeps charging.
 * Answers the plan set, with the organization as it was before, or null when nothing changed.
 */
export async function applyBillingEvent(
  data: Organizations,
  stripe: Pick<StripeGateway, 'subscription' | 'endNow'>,
  log: Logger,
  event: SubscriptionEvent,
): Promise<AppliedPlan | null> {
  const found = await findSubscriptionOrganization(
    data,
    stripe,
    log,
    event.subscriptionId,
    event.organizationId,
  )
  if (!found) return null
  const { scope, organization, subscription } = found
  const organizationId = organization.id
  if (organization.plan === 'internal') {
    return ignored(log, `organization ${organizationId} is on the internal plan, set by hand`)
  }
  const plan = planOfSubscription(subscription.status, subscription.lookupKey)
  const kept = organization.stripeSubscriptionId
  const replaced = kept !== null && kept !== subscription.id
  if (plan === 'free' && replaced) {
    return ignored(log, `subscription ${subscription.id} was replaced`)
  }
  if (replaced && (await isLive(stripe, kept))) {
    await stripe.endNow(subscription.id)
    log.warn({ organizationId, kept, ended: subscription.id }, 'duplicate subscription ended')
    return null
  }
  await scope.setPlan(plan, stripeRefs(subscription, plan))
  log.info({ organizationId, plan }, 'plan updated')
  return { organization, plan, subscription }
}

type MailKind = 'receipt' | 'failed payment' | 'renewal' | 'downgraded'
type EventOf<K extends BillingEvent['kind']> = Extract<BillingEvent, { kind: K }>

export function settleBillingEvent(
  deps: Pick<AppDeps, 'data' | 'stripe' | 'mailer' | 'env'>,
  log: Logger,
  event: BillingEvent,
): Promise<void> {
  const { data, stripe, mailer } = deps
  const links = { billing: billingLink(deps.env.webUrl) }

  const notSent = (organizationId: string, kind: MailKind, err: unknown) =>
    log.error({ err, organizationId, mail: kind }, 'billing email not sent')

  async function send(organizationId: string, kind: MailKind, email: RenderedEmail, to: string[]) {
    if (to.length === 0) return notSent(organizationId, kind, new Error('no address to send to'))
    await sendMails(mailer, email, to, (err) => notSent(organizationId, kind, err))
  }

  async function settleTopUp(topUp: EventOf<'top-up'>) {
    if (!topUp.paid) return
    const found = await findOrganization(
      data,
      log,
      topUp.organizationId,
      `top-up ${topUp.sessionId}`,
    )
    if (!found) return
    const credited = await found.scope.usage.credit(topUp.cents, {
      idempotencyKey: `checkout:${topUp.sessionId}`,
    })
    if (topUp.customerId) await found.scope.setStripeCustomer(topUp.customerId)
    if (credited) {
      log.info({ organizationId: found.organization.id, cents: topUp.cents }, 'credits topped up')
    }
  }

  async function settleReversal(reversal: EventOf<'payment-reversed'>) {
    const topUp = await stripe.topUpPayment(reversal.paymentIntentId)
    if (!topUp) return
    const found = await findOrganization(
      data,
      log,
      topUp.organizationId,
      `top-up ${reversal.paymentIntentId}`,
    )
    if (!found) return
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
        { organizationId: found.organization.id, cents, reversalId: reversal.reversalId },
        'top-up taken back',
      )
    }
  }

  async function settleRenewal(upcoming: EventOf<'invoice-upcoming'>) {
    const found = await findSubscriptionOrganization(data, stripe, log, upcoming.subscriptionId)
    if (!found) return
    const { organization, subscription } = found
    const paid = subscriptionOfLookupKey(subscription.lookupKey)
    if (paid?.cycle !== 'yearly') return
    const customer = await stripe.customer(subscription.customerId)
    const email = renewEmail({
      plan: PLAN_LABELS[paid.plan],
      charge: chargeOf(upcoming.amount, customer.card),
      renewsOn: dayOf(subscription.periodEnd),
      daysLeft: daysUntil(new Date(subscription.periodEnd * 1000), new Date()),
      links,
    })
    await send(organization.id, 'renewal', email, recipients(customer.email))
  }

  async function settleReceipt(invoice: EventOf<'invoice-paid'>) {
    if (invoice.amount.amount === 0) return
    const found = await findSubscriptionOrganization(data, stripe, log, invoice.subscriptionId)
    if (!found) return
    const { organization, subscription } = found
    const paid = subscriptionOfLookupKey(subscription.lookupKey)
    if (!paid) return void ignored(log, `subscription ${subscription.id} bills no known price`)
    const customer = await stripe.customer(subscription.customerId)
    const email = receiptEmail({
      plan: PLAN_LABELS[paid.plan],
      billing: paid.cycle,
      charge: chargeOf(invoice.amount, customer.card),
      renewsOn: dayOf(subscription.periodEnd),
      links: { ...links, invoice: invoice.invoiceUrl ?? links.billing },
    })
    await send(organization.id, 'receipt', email, recipients(customer.email))
  }

  async function settleFailed(failed: EventOf<'invoice-failed'>) {
    if (failed.nextAttempt === null) return
    const found = await findSubscriptionOrganization(data, stripe, log, failed.subscriptionId)
    if (!found) return
    const { organization, scope, subscription } = found
    const [customer, members] = await Promise.all([
      stripe.customer(subscription.customerId),
      scope.members.list(),
    ])
    const email = failedEmail({
      charge: chargeOf(failed.amount, customer.card),
      retryInDays: daysUntil(new Date(failed.nextAttempt * 1000), new Date()),
      links,
    })
    await send(
      organization.id,
      'failed payment',
      email,
      recipients(customer.email, ...adminsOf(members)),
    )
  }

  async function settleDowngrade({ organization, plan, subscription }: AppliedPlan) {
    const previousPlan = organization.plan
    if (!downgradeDue({ previousPlan, plan, cancellationReason: subscription.cancellationReason }))
      return
    const [customer, members] = await Promise.all([
      stripe.customer(subscription.customerId),
      data.asSystem(organization.id).members.list(),
    ])
    const email = downgradedEmail({
      organization: organization.name,
      plan: PLAN_LABELS[previousPlan],
      links,
    })
    await send(
      organization.id,
      'downgraded',
      email,
      recipients(customer.email, ...adminsOf(members)),
    )
  }

  async function settleSubscription(event: SubscriptionEvent) {
    const applied = await applyBillingEvent(data, stripe, log, event)
    if (!applied) return
    try {
      await settleDowngrade(applied)
    } catch (err) {
      notSent(applied.organization.id, 'downgraded', err)
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
