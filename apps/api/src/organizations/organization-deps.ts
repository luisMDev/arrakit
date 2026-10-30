import type { OrganizationDeps } from '@arrakit/auth'
import type { ScopedData } from '@arrakit/db'
import { PLAN_OFFERS, type Plan, seatLimitMessage } from '@arrakit/plans'
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
    seats(organization) {
      const plan = organization.plan as Plan
      return { limit: PLAN_OFFERS[plan].seats, full: seatLimitMessage(plan) }
    },
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
