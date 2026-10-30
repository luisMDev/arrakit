import type { OrganizationRow } from '@arrakit/db'

export const organizationSummary = ({ id, name, slug, plan }: OrganizationRow) => ({
  id,
  name,
  slug,
  plan,
})
