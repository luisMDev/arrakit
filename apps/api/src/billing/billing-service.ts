import type { BillingView } from '@arrakit/contract'
import type { OrganizationRow } from '@arrakit/db'
import { canceledEmail } from '@arrakit/emails'
import { PLAN_LABELS, PLAN_OFFERS } from '@arrakit/plans'
import { ORPCError } from '@orpc/server'

import { dayOf } from '../day'
import type { MemberContext } from '../orpc/context'
import { adminsOf, billingLink, recipients, sendMails } from './billing-mail'
import {
  type BillingSnapshot,
  STRIPE_UNREACHABLE,
  type StripeGateway,
  type SubscriptionState,
} from './stripe-gateway'
import {
  type BilledPlan,
  type PaidSubscription,
  billedPlanOf,
  subscriptionOfLookupKey,
  whenChangeApplies,
} from './subscription-plan'

const INVOICE_STATUS = { paid: 'paid', open: 'open', uncollectible: 'failed' } as const

type BillingOrganization = Pick<OrganizationRow, 'plan' | 'name'>

export function billingView(
  organization: BillingOrganization,
  snapshot: BillingSnapshot | null,
): BillingView {
  const { seats } = PLAN_OFFERS[organization.plan]
  const unbilled = organization.plan === 'free' || organization.plan === 'internal'
  const subscription = unbilled ? null : (snapshot?.subscription ?? null)
  const customer = snapshot?.customer ?? null
  const cancelled = subscription?.cancelAtPeriodEnd ?? false
  const scheduled = subscription?.scheduled ?? null
  const scheduledChoice = scheduled ? subscriptionOfLookupKey(scheduled.lookupKey) : null
  const periodEnd = subscription ? dayOf(subscription.periodEnd) : null
  return {
    plan: organization.plan,
    cycle: billedPlanOf(subscription?.lookupKey ?? null)?.cycle ?? null,
    renewsOn: cancelled ? null : periodEnd,
    endsOn: cancelled ? periodEnd : null,
    nextInvoice: cancelled ? null : ((scheduled ? scheduled.amount : subscription?.amount) ?? null),
    scheduledChange:
      scheduled && scheduledChoice && !cancelled
        ? { ...scheduledChoice, on: dayOf(scheduled.at) }
        : null,
    seats,
    card: customer?.card ?? null,
    billingEmail: customer?.email || null,
    invoiceTo: customer?.name || organization.name,
    taxId: customer?.taxId || null,
    invoices: (snapshot?.invoices ?? []).map((invoice) => ({
      id: invoice.id,
      issuedOn: dayOf(invoice.created),
      total: invoice.total,
      status: INVOICE_STATUS[invoice.status],
      pdfUrl: invoice.pdfUrl || null,
    })),
  }
}

export function refuseInternal(organization: OrganizationRow): void {
  if (organization.plan === 'internal') {
    throw new ORPCError('CONFLICT', {
      message: 'Your organization is on Internal: there is nothing to bill.',
    })
  }
}

export interface PaidOrganization {
  organization: OrganizationRow
  subscription: SubscriptionState
  current: BilledPlan
}

export async function billingSnapshot(
  stripe: StripeGateway,
  organization: OrganizationRow,
): Promise<BillingSnapshot | null> {
  const customerId = organization.stripeCustomerId
  return customerId ? stripe.billing(customerId, organization.stripeSubscriptionId) : null
}

export async function paidOrganization(context: MemberContext): Promise<PaidOrganization> {
  const { activeOrganization: organization } = context
  refuseInternal(organization)
  const { stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId } = organization
  if (organization.plan === 'free' || !customerId || !subscriptionId) {
    throw new ORPCError('CONFLICT', {
      message: 'Your organization is on Free. Pick a plan to pay for it.',
    })
  }
  const subscription = await context.deps.stripe.subscription(subscriptionId)
  const current = billedPlanOf(subscription.lookupKey)
  if (!current) {
    context.log.error(
      { organizationId: organization.id, subscriptionId },
      'subscription bills no known price',
    )
    throw new ORPCError('BAD_GATEWAY', { message: STRIPE_UNREACHABLE })
  }
  return { organization, subscription, current }
}

export function changeApplies(paid: PaidOrganization, to: PaidSubscription): 'now' | 'renewal' {
  const when = whenChangeApplies(paid.current, to)
  if (!when) {
    throw new ORPCError('CONFLICT', {
      message: `Your organization is already on ${PLAN_LABELS[to.plan]}, billed ${to.cycle}.`,
    })
  }
  return when
}

export async function sendCancellation(
  context: MemberContext,
  paid: PaidOrganization,
  cancelledBy: string,
): Promise<void> {
  const notSent = (err: unknown) =>
    context.log.error({ err, organizationId: paid.organization.id }, 'cancellation email not sent')
  try {
    const members = await context.scope.members.list()
    const email = canceledEmail({
      plan: PLAN_LABELS[paid.organization.plan],
      endsOn: dayOf(paid.subscription.periodEnd),
      links: { billing: billingLink(context.deps.env.webUrl) },
    })
    await sendMails(
      context.deps.mailer,
      email,
      recipients(cancelledBy, ...adminsOf(members)),
      notSent,
    )
  } catch (err) {
    notSent(err)
  }
}
