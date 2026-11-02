import { APIError } from 'better-auth/api'

import type { AuthDeps } from './auth'

export const OWNER_KEEPS_ACCOUNT =
  'You own an organization. Delete the organization first, in Settings → Security and data.'

/** Better Auth's `delete-user`: never for an owner; the invitations addressed to them go too. */
export function deleteUser(data: AuthDeps['data']) {
  return {
    enabled: true,
    async beforeDelete(user: { id: string; email: string }) {
      if ((await data.clearForAccountDeletion(user)) === 'owner') {
        throw new APIError('CONFLICT', { message: OWNER_KEEPS_ACCOUNT })
      }
    },
  }
}
