import { memberEmail, signinEmail } from '@arrakit/emails'

import { MAGIC_LINK_MINUTES, isTrustedOrigin } from './config'
import type { AuthDeps, InvitationForMail } from './deps'

const JOIN_PATH = /^\/join\/([^/]+)$/
const DAY_MS = 24 * 60 * 60 * 1000

export function invitationIdOf(linkURL: string, config: AuthDeps['config']): string | null {
  let callback: URL
  try {
    const raw = new URL(linkURL).searchParams.get('callbackURL')
    if (!raw) return null
    callback = new URL(raw, config.baseURL)
  } catch {
    return null
  }
  if (!isTrustedOrigin(callback.origin, config.trustedOrigins)) return null
  const match = JOIN_PATH.exec(callback.pathname)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

const inviterLabel = (inviter: InvitationForMail['inviter']) =>
  inviter.name.trim() || inviter.email.split('@')[0] || inviter.email

export const expiresInDays = (expiresAt: Date, now: Date) =>
  Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS))

export function magicLinkSender(deps: AuthDeps, now: () => Date = () => new Date()) {
  return async ({ email, url }: { email: string; url: string }) => {
    const invitationId = invitationIdOf(url, deps.config)
    const invitation = invitationId ? await deps.invitationFor(invitationId, email) : null
    const mail = invitation
      ? memberEmail({
          organization: { name: invitation.organization.name },
          inviter: inviterLabel(invitation.inviter),
          expiresInDays: expiresInDays(invitation.expiresAt, now()),
          links: { join: url },
        })
      : signinEmail({ minutes: MAGIC_LINK_MINUTES, links: { signIn: url } })
    await deps.mailer.send({ to: email, subject: mail.subject, html: mail.html, text: mail.text })
  }
}
