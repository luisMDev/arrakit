import type { Mailer } from '@arrakit/emails'
import type { BetterAuthOptions } from 'better-auth'

import type { AuthConfig } from './config'

/** A pending invitation addressed to an email, as the magic link sender needs it. */
export interface InvitationForMail {
  expiresAt: Date
  organization: { name: string }
  inviter: { name: string; email: string }
}

/** Everything createAuth() needs; apps/api builds it from @arrakit/db and its mailer. */
export interface AuthDeps {
  config: AuthConfig
  /** The Better Auth adapter from `@arrakit/db` (`data.authDatabase`). */
  database: NonNullable<BetterAuthOptions['database']>
  mailer: Mailer
  invitationFor(invitationId: string, email: string): Promise<InvitationForMail | null>
  organizationOf(userId: string): Promise<{ id: string } | null>
  /** Adds Better Auth's testUtils plugin (tests only). */
  testing?: boolean
}
