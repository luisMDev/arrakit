import type { BillingView } from '@arrakit/contract'
import type { OrganizationRow, OrganizationScope } from '@arrakit/db'
import type { Mailer } from '@arrakit/emails'
import { PLAN_LABELS } from '@arrakit/plans'
import { ORPCError } from '@orpc/server'

import type { Logger } from '../observability/logger'
import { adminsOf, canceledMails, recipients } from './billing-mail'
import { dayOf } from '../day'
import { billingView } from './billing-view'
import type { BillingSnapshot, StripeGateway } from './stripe-gateway'
import {
  type PaidSubscription,
  subscriptionOfLookupKey,
  whenChangeApplies,
} from './subscription-plan'

const LOAD_REFUSAL = "Couldn't load billing from Stripe. Try again in a minute."
export const CHANGE_REFUSAL = "Couldn't reach Stripe, so nothing changed. Try again in a minute."
export const CHECKOUT_REFUSAL = "Couldn't open the payment form. Try again in a minute."
const CARD_DECLINED = 'Your card was declined. Update it under Payment, then try again.'

export function refuseInternal(organization: OrganizationRow): void {
  if (organization.plan === 'internal') {
    throw new ORPCError('CONFLICT', {
      message: 'Your organization is on Internal: there is nothing to bill.',
    })
  }
}

interface PaidOrganization {
  organization: OrganizationRow
  subscriptionId: string
  current: PaidSubscription
  periodEnd: number
}

interface BillingDeps {
  scope: OrganizationScope
  stripe: StripeGateway | null
  mailer: Mailer
  webUrl: string
  log: Logger
}

export function billingService(deps: BillingDeps) {
  async function callStripe<T>(
    organization: Pick<OrganizationRow, 'id'>,
    what: string,
    run: () => Promise<T>,
    refusal = LOAD_REFUSAL,
  ): Promise<T> {
    try {
      return await run()
    } catch (err) {
      if (err instanceof ORPCError) throw err
      deps.log.error(
        { err, organizationId: organization.id, operation: what },
        'Stripe call failed',
      )
      if ((err as { type?: string } | null)?.type === 'StripeCardError') {
        throw new ORPCError('PAYMENT_REQUIRED', { status: 402, message: CARD_DECLINED })
      }
      throw new ORPCError('BAD_GATEWAY', { message: refusal })
    }
  }

  async function snapshot(organization: OrganizationRow): Promise<BillingSnapshot | null> {
    const customerId = organization.stripeCustomerId
    const stripe = deps.stripe
    if (!customerId || !stripe) return null
    return callStripe(organization, 'load billing', () =>
      stripe.billing(customerId, organization.stripeSubscriptionId),
    )
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
    const loaded = await snapshot(organization)
    const current = subscriptionOfLookupKey(loaded?.subscription?.lookupKey ?? null)
    if (!loaded?.subscription || !current) {
      deps.log.error(
        { organizationId: organization.id, subscriptionId },
        'subscription bills no known price',
      )
      throw new ORPCError('BAD_GATEWAY', { message: LOAD_REFUSAL })
    }
    return { organization, subscriptionId, current, periodEnd: loaded.subscription.periodEnd }
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

  async function sendCancellation(
    organization: OrganizationRow,
    cancelledBy: string,
    loaded: BillingSnapshot | null,
  ): Promise<void> {
    const notSent = (err: unknown) =>
      deps.log.error({ err, organizationId: organization.id }, 'cancellation email not sent')
    if (!loaded?.subscription) {
      deps.log.error(
        { organizationId: organization.id, reason: 'Stripe shows no subscription' },
        'cancellation email not sent',
      )
      return
    }
    try {
      const members = await deps.scope.members.list()
      const mails = canceledMails({
        plan: PLAN_LABELS[organization.plan],
        endsOn: dayOf(loaded.subscription.periodEnd),
        to: recipients(cancelledBy, ...adminsOf(members)),
        webOrigin: deps.webUrl,
      })
      const sent = await Promise.allSettled(mails.map((mail) => deps.mailer.send(mail)))
      for (const result of sent) {
        if (result.status === 'rejected') notSent(result.reason)
      }
    } catch (err) {
      notSent(err)
    }
  }

  return { callStripe, snapshot, view, paidOrganization, applies, sendCancellation }
}
