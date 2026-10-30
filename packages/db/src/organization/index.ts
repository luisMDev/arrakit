import type { Plan } from '@arrakit/plans'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'

import type { Database } from '../connection'
import type { DataContext } from '../context'
import { type OrganizationId, toOrganizationId } from '../organization-id'
import { organizationRoles, organizations, teamMembers, teams, users } from '../schema/index'
import { membersScope } from './members'
import { usageScope } from './usage'

export type OrganizationRow = typeof organizations.$inferSelect

export interface StripeRefs {
  customerId: string
  subscriptionId: string | null
  anchor?: Date
}

/** With `lock`, the row is held (for no key update) until the transaction ends. */
export async function organizationRow(
  db: Database,
  id: string,
  { lock = false } = {},
): Promise<OrganizationRow | undefined> {
  const query = db.select().from(organizations).where(eq(organizations.id, id))
  const [row] = await (lock ? query.for('no key update') : query)
  return row
}

export function forOrganization(ctx: DataContext, id: string) {
  // Throws synchronously on a non-UUID, before any query.
  const organizationId: OrganizationId = toOrganizationId(id)

  async function updateOrganization(
    values: PgUpdateSetSource<typeof organizations>,
  ): Promise<OrganizationRow | undefined> {
    const [row] = await ctx.db
      .update(organizations)
      .set(values)
      .where(eq(organizations.id, organizationId))
      .returning()
    return row
  }

  return {
    /** The organization's own row, or undefined when it is gone. */
    organization: () => organizationRow(ctx.db, organizationId),
    /** Sets the plan (and Stripe ids when given). Free clears usage_anchor. */
    setPlan(plan: Plan, stripe?: StripeRefs): Promise<OrganizationRow | undefined> {
      const anchor =
        plan === 'free'
          ? { usageAnchor: null }
          : stripe?.anchor
            ? { usageAnchor: stripe.anchor }
            : {}
      const ids = stripe
        ? { stripeCustomerId: stripe.customerId, stripeSubscriptionId: stripe.subscriptionId }
        : {}
      return updateOrganization({ plan, ...anchor, ...ids })
    },
    /** Sets the Stripe customer only when it is still null; returns the row as it is now. */
    setStripeCustomer: (customerId: string) =>
      updateOrganization({
        stripeCustomerId: sql`coalesce(${organizations.stripeCustomerId}, ${customerId})`,
      }),
    files: ctx.storage.forOrganization(organizationId),
    /** The organization's custom roles (Better Auth dynamic access control). */
    customRoles: (): Promise<{ role: string; permission: string }[]> =>
      ctx.db
        .select({ role: organizationRoles.role, permission: organizationRoles.permission })
        .from(organizationRoles)
        .where(eq(organizationRoles.organizationId, organizationId))
        .orderBy(asc(organizationRoles.role)),
    /** The people on one of the organization's teams, oldest first; empty for another's team. */
    teamMembers: (teamId: string) =>
      ctx.db
        .select({ userId: users.id, name: users.name, email: users.email, image: users.image })
        .from(teamMembers)
        .innerJoin(teams, eq(teams.id, teamMembers.teamId))
        .innerJoin(users, eq(users.id, teamMembers.userId))
        .where(and(eq(teamMembers.teamId, teamId), eq(teams.organizationId, organizationId)))
        .orderBy(asc(teamMembers.createdAt), asc(teamMembers.id)),
    members: membersScope(ctx, organizationId),
    usage: usageScope(ctx, organizationId),
  }
}

export type OrganizationScope = ReturnType<typeof forOrganization>
