import { member } from '../orpc/base'
import { notInOrganization } from '../orpc/context'
import { organizationSummary } from '../organizations/organization-summary'
import { queueStoragePurge } from '../workers/storage-purge'

export const organizationsRouter = {
  update: member('admin').organizations.update.handler(async ({ context, input }) => {
    const renamed = await context.scope.rename(input.name ?? '')
    if (!renamed) throw notInOrganization()
    return organizationSummary(renamed)
  }),

  delete: member('owner').organizations.delete.handler(async ({ context }) => {
    const { id: organizationId, stripeSubscriptionId } = context.activeOrganization
    if (stripeSubscriptionId) await context.deps.stripe.endNow(stripeSubscriptionId)
    if (!(await context.deps.data.deleteOrganization(organizationId))) throw notInOrganization()
    await queueStoragePurge(context.deps.data.jobs, { organizationId, folder: '' }, context.log)
  }),
}
