import { PLAN_LABELS } from '@arrakit/plans'
import { ORPCError } from '@orpc/server'

import { stripeRefs } from '../billing/settle-event'
import { billingService, billingView, refuseInternal } from '../billing/billing-service'
import { planOfSubscription } from '../billing/subscription-plan'
import { dayOf } from '../day'
import { member } from '../orpc/base'
import type { MemberContext } from '../orpc/context'

const reader = member({ billing: ['read'] })
const manager = member({ billing: ['manage'] })

async function setCancelled(context: MemberContext, cancelledBy: string | null) {
  const service = billingService(context)
  const paid = await service.paidOrganization(context.activeOrganization)
  await context.deps.stripe.cancelAtPeriodEnd(paid.subscription, cancelledBy !== null)
  const [snapshot] = await Promise.all([
    service.snapshot(paid.organization),
    cancelledBy && service.sendCancellation(paid, cancelledBy),
  ])
  return billingView(paid.organization, snapshot)
}

export const billingRouter = {
  checkout: manager.billing.checkout.handler(async ({ context, input }) => {
    const { activeOrganization: organization } = context
    const { stripe, env } = context.deps
    if (organization.plan !== 'free') {
      throw new ORPCError('CONFLICT', {
        message: `Your organization is on ${PLAN_LABELS[organization.plan]}. Switch plans in Settings → Billing.`,
      })
    }
    const { clientSecret } = await stripe.checkout({
      organizationId: organization.id,
      plan: input.plan,
      cycle: input.cycle,
      customerId: organization.stripeCustomerId,
      email: context.user.email,
      returnUrl: `${env.webUrl}/app/welcome?session_id={CHECKOUT_SESSION_ID}`,
    })
    return { clientSecret, publishableKey: stripe.publishableKey }
  }),

  get: reader.billing.get.handler(async ({ context }) =>
    billingService(context).view(context.activeOrganization),
  ),

  previewChange: manager.billing.previewChange.handler(async ({ context, input }) => {
    const service = billingService(context)
    const paid = await service.paidOrganization(context.activeOrganization)
    const applies = service.applies(paid, input)
    const { stripe } = context.deps
    const [dueToday, nextInvoice] = await Promise.all([
      applies === 'now' ? stripe.previewNow(paid.subscription, input) : null,
      stripe.price(input),
    ])
    return {
      applies,
      on: applies === 'now' ? dayOf(new Date()) : dayOf(paid.subscription.periodEnd),
      dueToday: dueToday ?? { amount: 0, currency: nextInvoice.currency },
      nextInvoice,
    }
  }),

  change: manager.billing.change.handler(async ({ context, input }) => {
    const service = billingService(context)
    const paid = await service.paidOrganization(context.activeOrganization)
    const { stripe } = context.deps
    const changed =
      service.applies(paid, input) === 'now'
        ? await stripe.changeNow(paid.subscription, input)
        : await stripe.changeAtRenewal(paid.subscription, input)
    const plan = planOfSubscription(changed.status, changed.lookupKey)
    await context.scope.setPlan(plan, stripeRefs(changed, plan))
    return service.view({ ...paid.organization, plan })
  }),

  cancel: manager.billing.cancel.handler(({ context }) =>
    setCancelled(context, context.user.email),
  ),

  resume: manager.billing.resume.handler(({ context }) => setCancelled(context, null)),

  portal: manager.billing.portal.handler(async ({ context, input }) => {
    const { activeOrganization: organization } = context
    refuseInternal(organization)
    const customerId = organization.stripeCustomerId
    if (!customerId) {
      throw new ORPCError('CONFLICT', {
        message: 'Your organization has no billing details yet. Pick a plan first.',
      })
    }
    const url = await context.deps.stripe.portal(
      customerId,
      `${context.deps.env.webUrl}/app/billing`,
      input.to,
    )
    return { url }
  }),

  topUp: manager.billing.topUp.handler(async ({ context, input }) => {
    const { activeOrganization: organization } = context
    const web = context.deps.env.webUrl
    return context.deps.stripe.topUpCheckout({
      organizationId: organization.id,
      cents: input.cents,
      customerId: organization.stripeCustomerId,
      email: context.user.email,
      successUrl: `${web}/app/billing?top_up=paid`,
      cancelUrl: `${web}/app/billing`,
    })
  }),
}
