import { ORPCError } from '@orpc/server'

import { member } from '../orpc/base'
import { notInOrganization } from '../orpc/context'
import { organizationSummary } from '../organizations/organization-summary'
import { queueStoragePurge } from '../workers/storage-purge'

const STRIPE_FAILED =
  "Couldn't cancel your plan with Stripe, so nothing was deleted. Try again in a minute."

export const organizationsRouter = {
  update: member('admin').organizations.update.handler(async ({ context, input }) => {
    const renamed = await context.scope.rename(input.name ?? '')
    if (!renamed) throw notInOrganization()
    return organizationSummary(renamed)
  }),

  delete: member('owner').organizations.delete.handler(async ({ context }) => {
    const organizationId = context.activeOrganization.id
    const subscriptionId = context.activeOrganization.stripeSubscriptionId
    if (subscriptionId) {
      const stripe = context.deps.stripe
      if (!stripe) throw new ORPCError('SERVICE_UNAVAILABLE', { message: STRIPE_FAILED })
      try {
        await stripe.endNow(subscriptionId)
      } catch (err) {
        context.log.error({ err, organizationId, subscriptionId }, 'ending the subscription failed')
        throw new ORPCError('BAD_GATEWAY', { message: STRIPE_FAILED })
      }
    }
    if (!(await context.data.deleteOrganization(organizationId))) throw notInOrganization()
    await queueStoragePurge(context.data.jobs, { organizationId, folder: '' }, context.log)
  }),
}
