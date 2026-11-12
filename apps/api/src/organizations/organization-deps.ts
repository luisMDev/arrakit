import type { OrganizationDeps } from '@arrakit/auth'
import { LATE_UPLOAD_SECONDS, type ScopedData } from '@arrakit/db'
import { PLAN_OFFERS, type Plan, seatLimitMessage } from '@arrakit/plans'
import { APIError } from 'better-auth/api'

import type { StripeGateway, StripeRefusal } from '../billing/stripe-gateway'
import type { Logger } from '../observability/logger'
import { queueStoragePurge } from '../workers/storage-purge'

export const apiRefusal: StripeRefusal = (code, message) => new APIError(code, { message })

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
      const organization = await data.asSystem(organizationId).organization()
      if (!organization?.stripeSubscriptionId) return
      await stripe.endNow(organization.stripeSubscriptionId)
    },
    async afterDelete(organizationId) {
      await data.revokeGrants(organizationId)
      const everything = { organizationId, folder: '' }
      // Upload links signed before the deletion still store bytes until they lapse.
      await queueStoragePurge(data.jobs, everything, log)
      await queueStoragePurge(data.jobs, everything, log, { startAfter: LATE_UPLOAD_SECONDS })
    },
    log,
  }
}
