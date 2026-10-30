import { PLAN_LABELS } from '@arrakit/plans'
import { ORPCError } from '@orpc/server'

import { applyBillingEvent } from '../billing/apply-billing-event'
import { billingView } from '../billing/billing-view'
import {
  CHANGE_REFUSAL,
  CHECKOUT_REFUSAL,
  billingService,
  refuseInternal,
} from '../billing/billing-service'
import type { StripeGateway } from '../billing/stripe-gateway'
import { dayOf } from '../day'
import { member } from '../orpc/base'
import { type MemberContext, requireStripe, requireTrustedOrigin } from '../orpc/context'

const admin = member('admin')
const fromApp = (message: string) => admin.use(requireTrustedOrigin(message)).use(requireStripe)
const pay = fromApp('Pay from the app.')
const changePlans = fromApp('Change plans from the app.')
const changeBilling = fromApp('Change billing from the app.')
const addCredits = fromApp('Add credits from the app.')

type StripeContext = MemberContext & { stripe: StripeGateway }

const serviceOf = (context: MemberContext) =>
  billingService({
    scope: context.scope,
    stripe: context.deps.stripe,
    mailer: context.deps.mailer,
    webUrl: context.deps.env.webUrl,
    log: context.log,
  })

async function setCancelled(context: StripeContext, cancelledBy: string | null) {
  const { activeOrganization: organization, stripe } = context
  refuseInternal(organization)
  const subscriptionId = organization.stripeSubscriptionId
  if (organization.plan === 'free' || !subscriptionId) {
    throw new ORPCError('CONFLICT', {
      message: 'Your organization is on Free: there is nothing to cancel.',
    })
  }
  const cancel = cancelledBy !== null
  const service = serviceOf(context)
  await service.callStripe(
    organization,
    cancel ? 'cancel' : 'resume',
    () => stripe.cancelAtPeriodEnd(subscriptionId, cancel),
    CHANGE_REFUSAL,
  )
  const snapshot = await service.snapshot(organization)
  if (cancelledBy) await service.sendCancellation(organization, cancelledBy, snapshot)
  return billingView(organization, snapshot)
}

export const billingRouter = {
  checkout: pay.billing.checkout.handler(async ({ context, input }) => {
    const { activeOrganization: organization, stripe } = context
    if (organization.plan !== 'free') {
      throw new ORPCError('CONFLICT', {
        message: `Your organization is on ${PLAN_LABELS[organization.plan]}. Switch plans in Settings → Billing.`,
      })
    }
    const { clientSecret } = await serviceOf(context).callStripe(
      organization,
      'checkout',
      () =>
        stripe.checkout({
          organizationId: organization.id,
          plan: input.plan,
          cycle: input.cycle,
          customerId: organization.stripeCustomerId,
          email: context.user.email,
          returnUrl: `${context.deps.env.webUrl}/app/welcome?session_id={CHECKOUT_SESSION_ID}`,
        }),
      CHECKOUT_REFUSAL,
    )
    return { clientSecret, publishableKey: stripe.publishableKey }
  }),

  get: admin.billing.get.handler(async ({ context }) =>
    serviceOf(context).view(context.activeOrganization),
  ),

  previewChange: changePlans.billing.previewChange.handler(async ({ context, input }) => {
    const service = serviceOf(context)
    const paid = await service.paidOrganization(context.activeOrganization)
    const applies = service.applies(paid, input)
    const { stripe } = context
    const [dueToday, nextInvoice] = await service.callStripe(
      paid.organization,
      'preview a change',
      () =>
        Promise.all([
          applies === 'now' ? stripe.previewNow(paid.subscriptionId, input) : null,
          stripe.price(input),
        ]),
    )
    return {
      applies,
      on: applies === 'now' ? dayOf(new Date()) : dayOf(paid.periodEnd),
      dueToday: dueToday ?? { amount: 0, currency: nextInvoice.currency },
      nextInvoice,
    }
  }),

  change: changePlans.billing.change.handler(async ({ context, input }) => {
    const service = serviceOf(context)
    const paid = await service.paidOrganization(context.activeOrganization)
    const applies = service.applies(paid, input)
    const { stripe } = context
    const requestedBy = context.user.email
    await service.callStripe(
      paid.organization,
      `change to ${input.plan} ${input.cycle}`,
      () =>
        applies === 'now'
          ? stripe.changeNow(paid.subscriptionId, input, requestedBy)
          : stripe.changeAtRenewal(paid.subscriptionId, input, requestedBy),
      CHANGE_REFUSAL,
    )
    const outcome = await service.callStripe(
      paid.organization,
      'read the changed subscription',
      () =>
        applyBillingEvent(context.data, stripe, {
          kind: 'subscription',
          subscriptionId: paid.subscriptionId,
          organizationId: paid.organization.id,
        }),
    )
    const plan = outcome.kind === 'applied' ? outcome.plan : paid.organization.plan
    return service.view({ ...paid.organization, plan })
  }),

  cancel: changePlans.billing.cancel.handler(({ context }) =>
    setCancelled(context, context.user.email),
  ),

  resume: changePlans.billing.resume.handler(({ context }) => setCancelled(context, null)),

  portal: changeBilling.billing.portal.handler(async ({ context, input }) => {
    const { activeOrganization: organization, stripe } = context
    refuseInternal(organization)
    const customerId = organization.stripeCustomerId
    if (!customerId) {
      throw new ORPCError('CONFLICT', {
        message: 'Your organization has no billing details yet. Pick a plan first.',
      })
    }
    const url = await serviceOf(context).callStripe(organization, 'open the portal', () =>
      stripe.portal(customerId, `${context.deps.env.webUrl}/app/billing`, input.to),
    )
    return { url }
  }),

  topUp: addCredits.billing.topUp.handler(async ({ context, input }) => {
    const { activeOrganization: organization, stripe } = context
    const web = context.deps.env.webUrl
    return serviceOf(context).callStripe(organization, 'top-up checkout', () =>
      stripe.topUpCheckout({
        organizationId: organization.id,
        cents: input.cents,
        customerId: organization.stripeCustomerId,
        email: context.user.email,
        successUrl: `${web}/app/billing?top_up=paid`,
        cancelUrl: `${web}/app/billing`,
      }),
    )
  }),
}
