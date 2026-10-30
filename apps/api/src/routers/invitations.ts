import { ORPCError } from '@orpc/server'

import type { OrganizationMembers, PendingInvitation } from '@arrakit/db'

import { authed, member } from '../orpc/base'
import { requireTrustedOrigin } from '../orpc/context'
import { sendInviteMail } from '../organizations/invite-mail'
import { invitationView } from '../organizations/invitation-view'
import { mapMemberErrors } from '../organizations/member-errors'

const admin = member('admin')
const fromApp = admin.use(requireTrustedOrigin('Invite from the app.'))

const NO_SUCH_INVITATION = 'No such invitation in your organization.'

type MarkSentContext = {
  activeOrganization: { id: string }
  scope: { members: Pick<OrganizationMembers, 'markEmailSent'> }
}

/**
 * Records that an invite email went out. The email is already sent, so a failed
 * write is logged and never fails the request: failing it would make the admin
 * press Resend again and send a second email.
 */
async function markSent(
  context: MarkSentContext,
  invitationId: string,
): Promise<PendingInvitation | undefined> {
  const organizationId = context.activeOrganization.id
  try {
    const marked = await context.scope.members.markEmailSent(invitationId)
    if (!marked) {
      console.error(
        `organization ${organizationId} invitation ${invitationId}: sent, but no longer pending to mark`,
      )
    }
    return marked
  } catch (err) {
    console.error(
      `organization ${organizationId} invitation ${invitationId}: sent, but not marked sent`,
      err,
    )
    return undefined
  }
}

export const invitationsRouter = {
  list: admin.invitations.list.handler(async ({ context }) =>
    (await context.scope.members.invitations()).map(invitationView),
  ),

  invite: fromApp.invitations.invite.handler(async ({ context, input }) => {
    const organizationId = context.activeOrganization.id
    const invitation = await mapMemberErrors(() =>
      context.scope.members.invite({
        email: input.email,
        role: input.role,
        inviterId: context.user.id,
      }),
    )
    try {
      await sendInviteMail(context.deps, context.headers, invitation)
    } catch (err) {
      console.error(
        `organization ${organizationId} invitation ${invitation.id}: the invite email did not go out`,
        err,
      )
      return invitationView(invitation)
    }
    const marked = await markSent(context, invitation.id)
    return invitationView(marked ?? { ...invitation, emailSent: true })
  }),

  resend: fromApp.invitations.resend.handler(async ({ context, input }) => {
    const invitation = await mapMemberErrors(() => context.scope.members.resend(input.id))
    if (!invitation) throw new ORPCError('NOT_FOUND', { message: NO_SUCH_INVITATION })
    try {
      await sendInviteMail(context.deps, context.headers, invitation)
    } catch (err) {
      console.error(
        `organization ${context.activeOrganization.id} invitation ${invitation.id}: the invite email did not go out again`,
        err,
      )
      throw new ORPCError('SERVICE_UNAVAILABLE', {
        message: `The invite to ${invitation.email} is saved, but its email did not go out. Press Resend to send it again.`,
      })
    }
    const marked = await markSent(context, invitation.id)
    return invitationView(marked ?? { ...invitation, emailSent: true })
  }),

  cancel: admin.invitations.cancel.handler(async ({ context, input }) => {
    if (!(await context.scope.members.cancel(input.id))) {
      throw new ORPCError('NOT_FOUND', { message: NO_SUCH_INVITATION })
    }
  }),

  accept: authed.invitations.accept.handler(async ({ context, input }) => {
    const { organization, role } = await mapMemberErrors(() =>
      context.data.acceptInvitation({
        invitationId: input.id,
        userId: context.user.id,
        email: context.user.email,
      }),
    )
    return {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        plan: organization.plan,
      },
      role,
    }
  }),
}
