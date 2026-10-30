import type { Mailer } from '@arrakit/emails'
import type { BetterAuthOptions } from 'better-auth'

import type { AuthConfig } from './config'

export interface InvitationForMail {
  expiresAt: Date
  organization: { name: string }
  inviter: { name: string; email: string }
}

/** What the organization plugin's rules need from the app (data layer, Stripe, jobs). */
export interface OrganizationDeps {
  /** The organization a new session starts in: the earliest joined, or null. */
  defaultOf(userId: string): Promise<string | null>
  isMember(userId: string, organizationId: string): Promise<boolean>
  /** The plan's seats, and the refusal when they are all taken. */
  seats(organization: Record<string, unknown>): { limit: number; full: string }
  /** Members plus live invitations, not counting one to `exceptEmail`. */
  seatsTaken(organizationId: string, exceptEmail: string): Promise<number>
  markInvitationEmailSent(
    organizationId: string,
    invitationId: string,
    sent: boolean,
  ): Promise<void>
  /** Deletes connector grants bound to the organization, only `userId`'s when given. */
  revokeGrants(organizationId: string, userId?: string): Promise<void>
  /** Runs before an organization is deleted; throwing an APIError keeps it. */
  beforeDelete(organizationId: string): Promise<void>
  afterDelete(organizationId: string): Promise<void>
  log: { error(fields: Record<string, unknown>, message: string): void }
}

export interface AuthDeps {
  config: AuthConfig
  /** The Better Auth adapter from `@arrakit/db` (`data.authDatabase`). */
  database: NonNullable<BetterAuthOptions['database']>
  mailer: Mailer
  invitationFor(invitationId: string, email: string): Promise<InvitationForMail | null>
  organizations: OrganizationDeps
  /** Where Better Auth writes its own messages (its console logger when unset). */
  logger?: BetterAuthOptions['logger']
  /** Adds Better Auth's testUtils plugin (tests only). */
  testing?: boolean
}
