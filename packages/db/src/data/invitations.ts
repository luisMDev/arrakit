import type { DataContext } from '../context'
import { NotImplementedError } from '../errors'
import type { Membership } from './membership'
import type { AssignableRole } from '../organization/members'
import type { OrganizationRow } from '../organization/organization'

export interface InvitationForPerson {
  id: string
  email: string
  role: AssignableRole
  expiresAt: Date
  organization: OrganizationRow
  inviter: { name: string; email: string }
}

export function invitationsData(_ctx: DataContext) {
  return {
    /** The live invitation `invitationId` addressed exactly to `email`, or null. */
    async invitationFor(
      _invitationId: string,
      _email: string,
    ): Promise<InvitationForPerson | null> {
      throw new NotImplementedError('invitationFor')
    },
    async acceptInvitation(_input: {
      invitationId: string
      userId: string
      email: string
    }): Promise<Membership> {
      throw new NotImplementedError('acceptInvitation')
    },
  }
}
