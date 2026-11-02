import type { OrganizationDeps } from '@arrakit/auth'
import type { ScopedData } from '@arrakit/db'
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
      const organization = await data.forOrganization(organizationId).organization()
      if (!organization?.stripeSubscriptionId) return
      await stripe.endNow(organization.stripeSubscriptionId)
    },
    async afterDelete(organizationId) {
      await data.revokeGrants(organizationId)
      await queueStoragePurge(data.jobs, { organizationId, folder: '' }, log)
    },
    log,
  }
}
