import type { ScopedData } from '@arrakit/db'

import type { OrganizationDeps } from './deps'

/** OrganizationDeps over a test database: Free-plan seats, nothing to end before a delete. */
export const testOrganizationDeps = (data: ScopedData): OrganizationDeps => ({
  defaultOf: async (userId) => (await data.memberOf(userId))?.organization.id ?? null,
  isMember: async (userId, organizationId) =>
    (await data.membershipIn(userId, organizationId)) !== null,
  seats: () => ({ limit: 1, full: 'All seats are taken.' }),
  seatsTaken: (organizationId, email) =>
    data.forOrganization(organizationId).members.seatsTaken(email),
  markInvitationEmailSent: (organizationId, id, sent) =>
    data.forOrganization(organizationId).members.markInvitationEmailSent(id, sent),
  revokeGrants: (organizationId, userId) => data.revokeGrants(organizationId, userId),
  beforeDelete: async () => {},
  afterDelete: async () => {},
  log: { error: () => {} },
})
