import type { OrganizationRow, OrganizationScope, ScopedData, StripeRefs } from '@arrakit/db'
import type { Plan } from '@arrakit/plans'

import type { StripeGateway, SubscriptionEvent, SubscriptionState } from './stripe-gateway'
import { planOfSubscription } from './subscription-plan'

type Ignored = { kind: 'ignored'; reason: string }

type FoundOrganization =
  | Ignored
  | {
      kind: 'found'
      organizationId: string
      scope: OrganizationScope
      organization: OrganizationRow
    }

type SubscriptionOrganization =
  Ignored | (Extract<FoundOrganization, { kind: 'found' }> & { subscription: SubscriptionState })

export type BillingOutcome =
  | Ignored
  | {
      kind: 'applied'
      organizationId: string
      organization: { name: string; slug: string }
      previousPlan: Plan
      plan: Plan
      subscription: SubscriptionState
    }

type DataLike = Pick<ScopedData, 'forOrganization'>

export const stripeRefs = (subscription: SubscriptionState, plan: Plan): StripeRefs => ({
  customerId: subscription.customerId,
  subscriptionId: plan === 'free' ? null : subscription.id,
  anchor: subscription.anchor,
})

export async function findOrganization(
  data: DataLike,
  organizationId: string | null,
  what: string,
): Promise<FoundOrganization> {
  if (!organizationId) return { kind: 'ignored', reason: `${what} names no organization` }
  let scope: OrganizationScope
  try {
    scope = data.forOrganization(organizationId)
  } catch {
    return { kind: 'ignored', reason: `${what} names no organization id` }
  }
  const organization = await scope.organization()
  if (!organization) return { kind: 'ignored', reason: `organization ${organizationId} is gone` }
  return { kind: 'found', organizationId: organization.id, scope, organization }
}

export async function findSubscriptionOrganization(
  data: DataLike,
  stripe: Pick<StripeGateway, 'subscription'>,
  subscriptionId: string | null,
  eventOrganizationId: string | null = null,
): Promise<SubscriptionOrganization> {
  if (!subscriptionId) return { kind: 'ignored', reason: 'no subscription' }
  const subscription = await stripe.subscription(subscriptionId)
  const organizationId = subscription.organizationId ?? eventOrganizationId
  const found = await findOrganization(data, organizationId, `subscription ${subscription.id}`)
  return found.kind === 'ignored' ? found : { ...found, subscription }
}

export async function applyBillingEvent(
  data: DataLike,
  stripe: Pick<StripeGateway, 'subscription'>,
  event: SubscriptionEvent,
): Promise<BillingOutcome> {
  const found = await findSubscriptionOrganization(
    data,
    stripe,
    event.subscriptionId,
    event.organizationId,
  )
  if (found.kind === 'ignored') return found
  const { organizationId, scope, organization, subscription } = found
  if (organization.plan === 'internal') {
    return {
      kind: 'ignored',
      reason: `organization ${organizationId} is on the internal plan, set by hand`,
    }
  }
  const plan = planOfSubscription(subscription.status, subscription.lookupKey)
  const replaced =
    organization.stripeSubscriptionId !== null &&
    organization.stripeSubscriptionId !== subscription.id
  if (plan === 'free' && replaced) {
    return { kind: 'ignored', reason: `subscription ${subscription.id} was replaced` }
  }
  await scope.setPlan(plan, stripeRefs(subscription, plan))
  return {
    kind: 'applied',
    organizationId,
    organization: { name: organization.name, slug: organization.slug },
    previousPlan: organization.plan,
    plan,
    subscription,
  }
}
