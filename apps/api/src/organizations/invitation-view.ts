import type { InvitationView } from '@arrakit/contract'
import type { PendingInvitation } from '@arrakit/db'

import { dayOf } from '../day'

export function invitationView(invitation: PendingInvitation): InvitationView {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    invitedOn: dayOf(invitation.sentAt),
    expiresAt: invitation.expiresAt.toISOString(),
    emailSent: invitation.emailSent,
  }
}
