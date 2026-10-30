import type { DataContext } from '../context'
import { type OrganizationId, toOrganizationId } from '../organization-id'
import { billingScope } from './billing'
import { membersScope } from './members'
import { organizationScope } from './organization'
import { storageScope } from './storage'
import { usageScope } from './usage'

export function forOrganization(ctx: DataContext, id: string) {
  // Throws synchronously on a non-UUID, before any query.
  const organizationId: OrganizationId = toOrganizationId(id)
  return {
    ...organizationScope(ctx, organizationId),
    ...billingScope(ctx, organizationId),
    ...storageScope(ctx, organizationId),
    members: membersScope(ctx, organizationId),
    usage: usageScope(ctx, organizationId),
  }
}

export type OrganizationScope = ReturnType<typeof forOrganization>
