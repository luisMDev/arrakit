import type { InvitationView } from '@arrakit/contract'
import type { PendingInvitation } from '@arrakit/db'

export function invitationView(invitation: PendingInvitation): InvitationView {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    invitedOn: invitation.sentAt.toISOString().slice(0, 10),
    expiresAt: invitation.expiresAt.toISOString(),
    emailSent: invitation.emailSent,
  }
}
