import type { BillingView } from '@arrakit/contract'
import type { ScopedData, OrganizationRow } from '@arrakit/db'
import type { Mailer } from '@arrakit/emails'
import { PLAN_LABELS } from '@arrakit/plans'
import { ORPCError } from '@orpc/server'

import { adminsOf, canceledMails, recipients } from './billing-mail'
import { billingView, dayOf } from './billing-view'
import type { BillingSnapshot, StripeGateway } from './stripe-gateway'
import {
  type PaidSubscription,
  subscriptionOfLookupKey,
  whenChangeApplies,
} from './subscription-plan'

export const LOAD_REFUSAL = "Couldn't load billing from Stripe. Try again in a minute."
export const CHANGE_REFUSAL = "Couldn't reach Stripe, so nothing changed. Try again in a minute."
export const CHECKOUT_REFUSAL = "Couldn't open the payment form. Try again in a minute."
export const CARD_DECLINED = 'Your card was declined. Update it under Payment, then try again.'
export const NOT_SET_UP = 'Payments are not set up yet.'

export async function callStripe<T>(
  organization: Pick<OrganizationRow, 'id'>,
  what: string,
  run: () => Promise<T>,
  refusal = LOAD_REFUSAL,
): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof ORPCError) throw err
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[billing] ${what} for organization ${organization.id} failed: ${reason}`)
    if ((err as { type?: string } | null)?.type === 'StripeCardError') {
      throw new ORPCError('PAYMENT_REQUIRED', { status: 402, message: CARD_DECLINED })
    }
    throw new ORPCError('BAD_GATEWAY', { message: refusal })
  }
}

export function requireGateway(stripe: StripeGateway | null): StripeGateway {
  if (!stripe) throw new ORPCError('SERVICE_UNAVAILABLE', { message: NOT_SET_UP })
  return stripe
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
  subscriptionId: string
  current: PaidSubscription
  periodEnd: number
}

export interface BillingDeps {
  data: ScopedData
  stripe: StripeGateway | null
  mailer: Mailer
  webUrl: string
}

export function billingService(deps: BillingDeps) {
  async function snapshot(organization: OrganizationRow): Promise<BillingSnapshot | null> {
    const customerId = organization.stripeCustomerId
    if (!customerId) return null
    const stripe = requireGateway(deps.stripe)
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
    const stripe = requireGateway(deps.stripe)
    const loaded = await callStripe(organization, 'load billing', () =>
      stripe.billing(customerId, subscriptionId),
    )
    const current = subscriptionOfLookupKey(loaded.subscription?.lookupKey ?? null)
    if (!loaded.subscription || !current) {
      console.error(
        `[billing] organization ${organization.id}: subscription ${subscriptionId} bills no known price`,
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
    if (!loaded?.subscription) {
      console.error(
        `[billing] organization ${organization.id}: cancellation email not sent, Stripe shows no subscription`,
      )
      return
    }
    try {
      const members = await deps.data.forOrganization(organization.id).members.list()
      const mails = canceledMails({
        organization,
        plan: PLAN_LABELS[organization.plan],
        endsOn: dayOf(loaded.subscription.periodEnd),
        to: recipients(cancelledBy, ...adminsOf(members)),
        webOrigin: deps.webUrl,
      })
      for (const mail of mails) await deps.mailer.send(mail)
    } catch (err) {
      console.error(
        `[billing] organization ${organization.id}: cancellation email not sent`,
        err instanceof Error ? err.stack : String(err),
      )
    }
  }

  return { snapshot, view, paidOrganization, applies, sendCancellation }
}
