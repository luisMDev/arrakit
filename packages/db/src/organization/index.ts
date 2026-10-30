import type { DataContext } from '../context'
import { type OrganizationId, toOrganizationId } from '../organization-id'
import { billingScope } from './billing'
import { membersScope } from './members'
import { organizationScope } from './organization'
import { storageScope } from './storage'
import { type OrganizationDb, organizationDb } from './tenant-db'
import { usageScope } from './usage'

export function forOrganization(ctx: DataContext, id: string) {
  // Throws synchronously on a non-UUID, before any query.
  const organizationId: OrganizationId = toOrganizationId(id)
  const tenant: OrganizationDb = organizationDb(ctx.db, organizationId)
  return {
    ...tenant,
    ...organizationScope(ctx, organizationId),
    ...billingScope(ctx, organizationId),
    ...storageScope(ctx, organizationId),
    members: membersScope(ctx, organizationId),
    usage: usageScope(ctx, organizationId),
  }
}

export type OrganizationScope = ReturnType<typeof forOrganization>
