import type { Plan } from '@arrakit/plans'
import { and, eq, isNull } from 'drizzle-orm'

import type { DataContext } from '../context'
import type { OrganizationId } from '../organization-id'
import { organizations } from '../schema/index'
import type { OrganizationRow } from './organization'

export interface StripeRefs {
  customerId: string
  subscriptionId: string | null
  anchor?: Date
}

export function billingScope(ctx: DataContext, organizationId: OrganizationId) {
  const read = async () => {
    const [row] = await ctx.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
    return row
  }

  return {
    /** Sets the plan (and Stripe ids when given). Free clears usage_anchor. */
    async setPlan(plan: Plan, stripe?: StripeRefs): Promise<OrganizationRow | undefined> {
      const anchor =
        plan === 'free'
          ? { usageAnchor: null }
          : stripe?.anchor
            ? { usageAnchor: stripe.anchor }
            : {}
      const ids = stripe
        ? { stripeCustomerId: stripe.customerId, stripeSubscriptionId: stripe.subscriptionId }
        : {}
      const [row] = await ctx.db
        .update(organizations)
        .set({ plan, ...anchor, ...ids })
        .where(eq(organizations.id, organizationId))
        .returning()
      return row
    },
    /** Sets the Stripe customer only when it is still null; returns the row as it is now. */
    async setStripeCustomer(customerId: string): Promise<OrganizationRow | undefined> {
      await ctx.db
        .update(organizations)
        .set({ stripeCustomerId: customerId })
        .where(and(eq(organizations.id, organizationId), isNull(organizations.stripeCustomerId)))
      return read()
    },
  }
}
