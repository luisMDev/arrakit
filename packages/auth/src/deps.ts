import type { Mailer } from '@arrakit/emails'
import type { BetterAuthOptions } from 'better-auth'

import type { AuthConfig } from './config'

export interface InvitationForMail {
  expiresAt: Date
  organization: { name: string }
  inviter: { name: string; email: string }
}

export interface AuthDeps {
  config: AuthConfig
  /** The Better Auth adapter from `@arrakit/db` (`data.authDatabase`). */
  database: NonNullable<BetterAuthOptions['database']>
  mailer: Mailer
  invitationFor(invitationId: string, email: string): Promise<InvitationForMail | null>
  organizationOf(userId: string): Promise<{ id: string } | null>
  /** Where Better Auth writes its own messages (its console logger when unset). */
  logger?: BetterAuthOptions['logger']
  /** Adds Better Auth's testUtils plugin (tests only). */
  testing?: boolean
}
