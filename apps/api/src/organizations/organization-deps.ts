import type { OrganizationDeps } from '@arrakit/auth'
import type { ScopedData } from '@arrakit/db'
import { PLAN_OFFERS, isPlan, seatLimitMessage } from '@arrakit/plans'
import { ORPCError } from '@orpc/server'
import { APIError } from 'better-auth/api'

import type { StripeGateway } from '../billing/stripe-gateway'
import type { Logger } from '../observability/logger'
import { queueStoragePurge } from '../workers/storage-purge'

/** Stripe refusals keep their status and message when they surface through Better Auth. */
const asAPIError = (err: unknown): unknown =>
  err instanceof ORPCError
    ? new APIError(err.status as ConstructorParameters<typeof APIError>[0], {
        message: err.message,
      })
    : err

export function organizationDeps(
  data: ScopedData,
  stripe: StripeGateway,
  log: Logger,
): OrganizationDeps {
  return {
    defaultOf: async (userId) => (await data.memberOf(userId))?.organization.id ?? null,
    isMember: async (userId, organizationId) =>
      (await data.membershipIn(userId, organizationId)) !== null,
    seats(organization) {
      const plan = isPlan(organization.plan) ? organization.plan : 'free'
      return { limit: PLAN_OFFERS[plan].seats, full: seatLimitMessage(plan) }
    },
    seatsTaken: (organizationId, email) =>
      data.forOrganization(organizationId).members.seatsTaken(email),
    markInvitationEmailSent: (organizationId, invitationId, sent) =>
      data.forOrganization(organizationId).members.markInvitationEmailSent(invitationId, sent),
    revokeGrants: (organizationId, userId) => data.revokeGrants(organizationId, userId),
    async beforeDelete(organizationId) {
      const organization = await data.forOrganization(organizationId).organization()
      if (!organization?.stripeSubscriptionId) return
      try {
        await stripe.endNow(organization.stripeSubscriptionId)
      } catch (err) {
        throw asAPIError(err)
      }
    },
    async afterDelete(organizationId) {
      await data.revokeGrants(organizationId)
      await queueStoragePurge(data.jobs, { organizationId, folder: '' }, log)
    },
    log,
  }
}
