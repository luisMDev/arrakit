import type { DataContext } from '../context'
import { NotImplementedError } from '../errors'
import type { OrganizationId } from '../organization-id'

export type OrganizationRole = 'owner' | 'admin' | 'member'
export type AssignableRole = 'admin' | 'member'

export interface MemberView {
  userId: string
  name: string
  email: string
  image: string | null
  role: OrganizationRole
  joinedAt: Date
}

export interface PendingInvitation {
  id: string
  email: string
  role: AssignableRole
  sentAt: Date
  expiresAt: Date
  emailSent: boolean
}

export interface OrganizationMembers {
  list(): Promise<MemberView[]>
  /** Live invitations (pending and unexpired), oldest first. */
  invitations(): Promise<PendingInvitation[]>
  invite(input: {
    email: string
    role: AssignableRole
    inviterId: string
  }): Promise<PendingInvitation>
  resend(id: string): Promise<PendingInvitation | undefined>
  markEmailSent(id: string): Promise<PendingInvitation | undefined>
  cancel(id: string): Promise<boolean>
  changeRole(actorUserId: string, email: string, role: AssignableRole): Promise<MemberView>
  remove(actorUserId: string, email: string): Promise<void>
}

export function membersScope(
  _ctx: DataContext,
  _organizationId: OrganizationId,
): OrganizationMembers {
  const todo = (what: string) => () => Promise.reject(new NotImplementedError(`members.${what}`))
  return {
    list: todo('list'),
    invitations: todo('invitations'),
    invite: todo('invite'),
    resend: todo('resend'),
    markEmailSent: todo('markEmailSent'),
    cancel: todo('cancel'),
    changeRole: todo('changeRole'),
    remove: todo('remove'),
  }
}
