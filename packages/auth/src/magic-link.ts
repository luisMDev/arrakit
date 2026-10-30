import { personName } from '@arrakit/address'
import { daysUntil, memberEmail, signinEmail, toMail } from '@arrakit/emails'

import { MAGIC_LINK_MINUTES, isTrustedOrigin } from './config'
import type { AuthDeps } from './deps'

const JOIN_PATH = /^\/join\/([^/]+)$/

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

export function magicLinkSender(deps: AuthDeps, now: () => Date = () => new Date()) {
  return async ({ email, url }: { email: string; url: string }) => {
    const invitationId = invitationIdOf(url, deps.config)
    const invitation = invitationId ? await deps.invitationFor(invitationId, email) : null
    const mail = invitation
      ? memberEmail({
          organization: invitation.organization.name,
          inviter: personName(invitation.inviter.name, invitation.inviter.email),
          expiresInDays: daysUntil(invitation.expiresAt, now()),
          links: { join: url },
        })
      : signinEmail({ minutes: MAGIC_LINK_MINUTES, links: { signIn: url } })
    await deps.mailer.send(toMail(mail, email))
  }
}
