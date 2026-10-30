import { ORPCError } from '@orpc/server'

import { member } from '../orpc/base'
import { mapMemberErrors } from '../organizations/member-errors'
import { queueStoragePurge } from '../workers/storage-purge'

const STRIPE_FAILED =
  "Couldn't cancel your plan with Stripe, so nothing was deleted. Try again in a minute."

export const organizationsRouter = {
  update: member('admin').organizations.update.handler(async ({ context, input }) => {
    const renamed = await mapMemberErrors(() => context.scope.rename(input.name ?? ''))
    if (!renamed) throw new ORPCError('NOT_FOUND', { message: 'Not found in your organization.' })
    return { id: renamed.id, name: renamed.name, slug: renamed.slug, plan: renamed.plan }
  }),

  delete: member('owner').organizations.delete.handler(async ({ context }) => {
    const organization = context.activeOrganization
    const subscriptionId = organization.stripeSubscriptionId
    if (subscriptionId) {
      const stripe = context.deps.stripe
      if (!stripe) throw new ORPCError('SERVICE_UNAVAILABLE', { message: STRIPE_FAILED })
      try {
        await stripe.endNow(subscriptionId)
      } catch (err) {
        console.error(
          `ending subscription ${subscriptionId} of organization ${organization.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        )
        throw new ORPCError('BAD_GATEWAY', { message: STRIPE_FAILED })
      }
    }
    if (!(await context.data.deleteOrganization(organization.id))) {
      throw new ORPCError('NOT_FOUND', { message: 'Not found in your organization.' })
    }
    await queueStoragePurge(context.data.jobs, { organizationId: organization.id, folder: '' })
  }),
}
