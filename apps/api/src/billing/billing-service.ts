import type { BillingView } from '@arrakit/contract'
import type { OrganizationRow } from '@arrakit/db'
import { canceledEmail } from '@arrakit/emails'
import { PLAN_LABELS } from '@arrakit/plans'
import { ORPCError } from '@orpc/server'

import { dayOf } from '../day'
import type { MemberContext } from '../orpc/context'
import { adminsOf, billingLink, mailsOf, recipients, sendMails } from './billing-mail'
import { billingView } from './billing-view'
import { type BillingSnapshot, STRIPE_UNREACHABLE, type SubscriptionState } from './stripe-gateway'
import {
  type PaidSubscription,
  subscriptionOfLookupKey,
  whenChangeApplies,
} from './subscription-plan'

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
  current: PaidSubscription
}

export function billingService(context: MemberContext) {
  const { stripe, mailer, env } = context.deps
  const { log, scope } = context

  async function snapshot(organization: OrganizationRow): Promise<BillingSnapshot | null> {
    const customerId = organization.stripeCustomerId
    return customerId ? stripe.billing(customerId, organization.stripeSubscriptionId) : null
  }

  async function view(organization: OrganizationRow): Promise<BillingView> {
    return billingView(organization, await snapshot(organization))
  }

  async function paidOrganization(organization: OrganizationRow): Promise<PaidOrganization> {
    refuseInternal(organization)
    const { stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId } = organization
    if (organization.plan === 'free' || !customerId || !subscriptionId) {
      throw new ORPCError('CONFLICT', {
        message: 'Your organization is on Free. Pick a plan to pay for it.',
      })
    }
    const subscription = await stripe.subscription(subscriptionId)
    const current = subscriptionOfLookupKey(subscription.lookupKey)
    if (!current) {
      log.error(
        { organizationId: organization.id, subscriptionId },
        'subscription bills no known price',
      )
      throw new ORPCError('BAD_GATEWAY', { message: STRIPE_UNREACHABLE })
    }
    return { organization, subscription, current }
  }

  function applies(paid: PaidOrganization, to: PaidSubscription): 'now' | 'renewal' {
    const when = whenChangeApplies(paid.current, to)
    if (!when) {
      throw new ORPCError('CONFLICT', {
        message: `Your organization is already on ${PLAN_LABELS[to.plan]}, billed ${to.cycle}.`,
      })
    }
    return when
  }

  async function sendCancellation(paid: PaidOrganization, cancelledBy: string): Promise<void> {
    const notSent = (err: unknown) =>
      log.error({ err, organizationId: paid.organization.id }, 'cancellation email not sent')
    try {
      const members = await scope.members.list()
      const email = canceledEmail({
        plan: PLAN_LABELS[paid.organization.plan],
        endsOn: dayOf(paid.subscription.periodEnd),
        links: { billing: billingLink(env.webUrl) },
      })
      await sendMails(
        mailer,
        mailsOf(email, recipients(cancelledBy, ...adminsOf(members))),
        notSent,
      )
    } catch (err) {
      notSent(err)
    }
  }

  return { snapshot, view, paidOrganization, applies, sendCancellation }
}
