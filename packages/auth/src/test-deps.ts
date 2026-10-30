import type { OrganizationDeps } from './auth'

/** OrganizationDeps for tests: Free-plan seats, nothing to end before a delete. */
export const testOrganizationDeps: OrganizationDeps = {
  seats: () => ({ limit: 1, full: 'All seats are taken.' }),
  beforeDelete: async () => {},
  afterDelete: async () => {},
  log: { error: () => {} },
}
