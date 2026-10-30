import type { OrganizationRow } from '@arrakit/db'
import { PLAN_LABELS } from '@arrakit/plans'
import { ORPCError } from '@orpc/server'

import { applyBillingEvent } from '../billing/apply-billing-event'
import { billingView, dayOf } from '../billing/billing-view'
import {
  CHANGE_REFUSAL,
  CHECKOUT_REFUSAL,
  billingService,
  refuseInternal,
  requireGateway,
} from '../billing/billing-service'
import { member } from '../orpc/base'
import { type MemberContext, requireTrustedOrigin } from '../orpc/context'

const admin = member('admin')
const pay = admin.use(requireTrustedOrigin('Pay from the app.'))
const changePlans = admin.use(requireTrustedOrigin('Change plans from the app.'))
const changeBilling = admin.use(requireTrustedOrigin('Change billing from the app.'))

const serviceOf = (context: MemberContext) =>
  billingService({
    data: context.data,
    stripe: context.deps.stripe,
    mailer: context.deps.mailer,
    webUrl: context.deps.env.webUrl,
    log: context.log,
  })

async function organizationOf(context: MemberContext): Promise<OrganizationRow> {
  return (await context.scope.organization()) ?? context.activeOrganization
}

async function setCancelled(context: MemberContext, cancelledBy: string | null) {
  const organization = await organizationOf(context)
  refuseInternal(organization)
  const subscriptionId = organization.stripeSubscriptionId
  if (organization.plan === 'free' || !subscriptionId) {
    throw new ORPCError('CONFLICT', {
      message: 'Your organization is on Free: there is nothing to cancel.',
    })
  }
  const stripe = requireGateway(context.deps.stripe)
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
    const stripe = requireGateway(context.deps.stripe)
    const organization = await organizationOf(context)
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
    serviceOf(context).view(await organizationOf(context)),
  ),

  previewChange: changePlans.billing.previewChange.handler(async ({ context, input }) => {
    const service = serviceOf(context)
    const paid = await service.paidOrganization(await organizationOf(context))
    const applies = service.applies(paid, input)
    const stripe = requireGateway(context.deps.stripe)
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
      on: applies === 'now' ? dayOf(Date.now() / 1000) : dayOf(paid.periodEnd),
      dueToday: dueToday ?? { amount: 0, currency: nextInvoice.currency },
      nextInvoice,
    }
  }),

  change: changePlans.billing.change.handler(async ({ context, input }) => {
    const service = serviceOf(context)
    const paid = await service.paidOrganization(await organizationOf(context))
    const applies = service.applies(paid, input)
    const stripe = requireGateway(context.deps.stripe)
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
    await service.callStripe(paid.organization, 'read the changed subscription', () =>
      applyBillingEvent(context.data, stripe, {
        kind: 'subscription',
        subscriptionId: paid.subscriptionId,
        organizationId: paid.organization.id,
      }),
    )
    return service.view(await organizationOf(context))
  }),

  cancel: changePlans.billing.cancel.handler(({ context }) =>
    setCancelled(context, context.user.email),
  ),

  resume: changePlans.billing.resume.handler(({ context }) => setCancelled(context, null)),

  portal: changeBilling.billing.portal.handler(async ({ context, input }) => {
    const organization = await organizationOf(context)
    refuseInternal(organization)
    const customerId = organization.stripeCustomerId
    if (!customerId) {
      throw new ORPCError('CONFLICT', {
        message: 'Your organization has no billing details yet. Pick a plan first.',
      })
    }
    const stripe = requireGateway(context.deps.stripe)
    const url = await serviceOf(context).callStripe(organization, 'open the portal', () =>
      stripe.portal(customerId, `${context.deps.env.webUrl}/app/billing`, input.to),
    )
    return { url }
  }),
}
