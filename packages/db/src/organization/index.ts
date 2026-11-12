import type { Plan } from '@arrakit/plans'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'

import type { Database } from '../connection'
import type { DataContext, ScopeContext } from '../context'
import { type OrganizationId, toOrganizationId } from '../organization-id'
import { organizations, teamMembers, teams, users } from '../schema/index'
import { artifactsScope } from './artifacts'
import { filesScope } from './files'
import { membersScope } from './members'
import { type Claims, scopedTo } from './scoped'
import { tasksScope } from './tasks'
import { usageScope } from './usage'
import { workspacesScope } from './workspaces'

export type OrganizationRow = typeof organizations.$inferSelect

export interface StripeRefs {
  customerId: string
  subscriptionId: string | null
  anchor?: Date
}

/** With `lock`, the row is held (for no key update) until the transaction ends. */
export async function organizationRow(
  tx: Database,
  id: string,
  { lock = false } = {},
): Promise<OrganizationRow | undefined> {
  const query = tx.select().from(organizations).where(eq(organizations.id, id))
  const [row] = await (lock ? query.for('no key update') : query)
  return row
}

/** Every operation of the scope runs under RLS with `claims`, confined to its organization. */
export function forOrganization(ctx: DataContext, claims: Claims) {
  // Throws synchronously on a non-UUID, before any query.
  const organizationId: OrganizationId = toOrganizationId(claims.org_id)
  const { db, ...rest } = ctx
  const scope: ScopeContext = {
    ...rest,
    scoped: scopedTo(db, { ...claims, org_id: organizationId }),
  }

  const updateOrganization = (
    values: PgUpdateSetSource<typeof organizations>,
  ): Promise<OrganizationRow | undefined> =>
    scope.scoped(async (tx) => {
      const [row] = await tx
        .update(organizations)
        .set(values)
        .where(eq(organizations.id, organizationId))
        .returning()
      return row
    })

  const usage = usageScope(scope, organizationId)
  const files = filesScope(scope, organizationId, usage)
  const artifacts = artifactsScope(scope, organizationId)

  return {
    /** The organization's own row, or undefined when it is gone. */
    organization: () => scope.scoped((tx) => organizationRow(tx, organizationId)),
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
    objects: scope.storage.forOrganization(organizationId),
    /** The people on one of the organization's teams, oldest first; empty for another's team. */
    teamMembers: (teamId: string) =>
      scope.scoped((tx) =>
        tx
          .select({ userId: users.id, name: users.name, email: users.email, image: users.image })
          .from(teamMembers)
          .innerJoin(teams, eq(teams.id, teamMembers.teamId))
          .innerJoin(users, eq(users.id, teamMembers.userId))
          .where(and(eq(teamMembers.teamId, teamId), eq(teams.organizationId, organizationId)))
          .orderBy(asc(teamMembers.createdAt), asc(teamMembers.id)),
      ),
    members: membersScope(scope, organizationId),
    usage,
    files,
    artifacts,
    tasks: tasksScope(scope, organizationId),
    workspaces: workspacesScope(scope, organizationId, files, artifacts),
  }
}

export type OrganizationScope = ReturnType<typeof forOrganization>
