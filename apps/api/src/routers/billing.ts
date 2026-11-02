import { PLAN_LABELS } from '@arrakit/plans'
import { ORPCError } from '@orpc/server'

import { stripeRefs } from '../billing/settle-event'
import {
  billingSnapshot,
  billingView,
  changeApplies,
  paidOrganization,
  refuseInternal,
  sendCancellation,
} from '../billing/billing-service'
import { planOfSubscription } from '../billing/subscription-plan'
import { dayOf, nowSeconds } from '../day'
import { member } from '../orpc/base'
import type { MemberContext } from '../orpc/context'

const PRORATION_DATE_VALID_SECONDS = 60 * 60

function prorationDateOf(previewed: number | null | undefined): number {
  const now = nowSeconds()
  const recent =
    typeof previewed === 'number' &&
    previewed <= now &&
    now - previewed <= PRORATION_DATE_VALID_SECONDS
  return recent ? previewed : now
}

const reader = member({ billing: ['read'] })
const manager = member({ billing: ['manage'] })

async function setCancelled(context: MemberContext, cancelledBy: string | null) {
  const { stripe } = context.deps
  const paid = await paidOrganization(context)
  await stripe.cancelAtPeriodEnd(paid.subscription, cancelledBy !== null)
  const [snapshot] = await Promise.all([
    billingSnapshot(stripe, paid.organization),
    cancelledBy && sendCancellation(context, paid, cancelledBy),
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

  get: reader.billing.get.handler(async ({ context }) => {
    const { activeOrganization: organization } = context
    return billingView(organization, await billingSnapshot(context.deps.stripe, organization))
  }),

  previewChange: manager.billing.previewChange.handler(async ({ context, input }) => {
    const paid = await paidOrganization(context)
    const applies = changeApplies(paid, input)
    const { stripe } = context.deps
    const prorationDate = applies === 'now' ? nowSeconds() : null
    const [dueToday, nextInvoice] = await Promise.all([
      prorationDate !== null ? stripe.previewNow(paid.subscription, input, prorationDate) : null,
      stripe.price(input),
    ])
    return {
      applies,
      on: applies === 'now' ? dayOf(new Date()) : dayOf(paid.subscription.periodEnd),
      dueToday: dueToday ?? { amount: 0, currency: nextInvoice.currency },
      nextInvoice,
      prorationDate,
    }
  }),

  change: manager.billing.change.handler(async ({ context, input }) => {
    const paid = await paidOrganization(context)
    const { stripe } = context.deps
    const choice = { plan: input.plan, cycle: input.cycle }
    const changed =
      changeApplies(paid, choice) === 'now'
        ? await stripe.changeNow(paid.subscription, choice, prorationDateOf(input.prorationDate))
        : await stripe.changeAtRenewal(paid.subscription, choice)
    const plan = planOfSubscription(changed.status, changed.lookupKey)
    await context.scope.setPlan(plan, stripeRefs(changed, plan))
    const organization = { ...paid.organization, plan }
    return billingView(organization, await billingSnapshot(stripe, organization))
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
