import { ORPCError } from '@orpc/server'

import type { PendingInvitation } from '@arrakit/db'

import { authed, member } from '../orpc/base'
import type { MemberContext } from '../orpc/context'
import { sendInviteMail } from '../organizations/invite-mail'
import { invitationView } from '../organizations/invitation-view'
import { organizationSummary } from '../organizations/organization-summary'

const admin = member('admin')

const NO_SUCH_INVITATION = 'No such invitation in your organization.'

/**
 * Sends the invite email and records that it went out. False when the email failed. The
 * email is already sent when the mark fails, so that is only logged: failing the request would
 * make the admin press Resend and send a second email.
 */
async function sendAndMark(
  context: MemberContext,
  invitation: PendingInvitation,
): Promise<PendingInvitation | null> {
  const ids = { organizationId: context.activeOrganization.id, invitationId: invitation.id }
  try {
    await sendInviteMail(context.deps, context.headers, invitation)
  } catch (err) {
    context.log.error({ err, ...ids }, 'invite email not sent')
    return null
  }
  try {
    const marked = await context.scope.members.markEmailSent(invitation.id)
    if (marked) return marked
    context.log.error(ids, 'invite email sent, but the invitation is no longer pending')
  } catch (err) {
    context.log.error({ err, ...ids }, 'invite email sent, but not marked sent')
  }
  return { ...invitation, emailSent: true }
}

export const invitationsRouter = {
  list: admin.invitations.list.handler(async ({ context }) =>
    (await context.scope.members.invitations()).map(invitationView),
  ),

  invite: admin.invitations.invite.handler(async ({ context, input }) => {
    const invitation = await context.scope.members.invite({
      email: input.email,
      role: input.role,
      inviterId: context.user.id,
    })
    return invitationView((await sendAndMark(context, invitation)) ?? invitation)
  }),

  resend: admin.invitations.resend.handler(async ({ context, input }) => {
    const invitation = await context.scope.members.resend(input.id)
    if (!invitation) throw new ORPCError('NOT_FOUND', { message: NO_SUCH_INVITATION })
    const sent = await sendAndMark(context, invitation)
    if (!sent) {
      throw new ORPCError('SERVICE_UNAVAILABLE', {
        message: `The invite to ${invitation.email} is saved, but its email did not go out. Press Resend to send it again.`,
      })
    }
    return invitationView(sent)
  }),

  cancel: admin.invitations.cancel.handler(async ({ context, input }) => {
    if (!(await context.scope.members.cancel(input.id))) {
      throw new ORPCError('NOT_FOUND', { message: NO_SUCH_INVITATION })
    }
  }),

  accept: authed.invitations.accept.handler(async ({ context, input }) => {
    const { organization, role } = await context.deps.data.acceptInvitation({
      invitationId: input.id,
      userId: context.user.id,
      email: context.user.email,
    })
    return { organization: organizationSummary(organization), role }
  }),
}
