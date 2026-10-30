import type { DataContext } from '../context'
import type { OrganizationId } from '../organization-id'
import type { OrganizationFiles } from '../storage/types'

export function storageScope(
  ctx: DataContext,
  organizationId: OrganizationId,
): { files: OrganizationFiles } {
  return { files: ctx.storage.forOrganization(organizationId) }
}
