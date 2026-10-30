import { authed, member, notImplemented } from '../orpc/base'

const admin = member('admin')

export const invitationsRouter = {
  list: admin.invitations.list.handler(() => notImplemented('invitations.list')),
  invite: admin.invitations.invite.handler(() => notImplemented('invitations.invite')),
  resend: admin.invitations.resend.handler(() => notImplemented('invitations.resend')),
  cancel: admin.invitations.cancel.handler(() => notImplemented('invitations.cancel')),
  accept: authed.invitations.accept.handler(() => notImplemented('invitations.accept')),
}
