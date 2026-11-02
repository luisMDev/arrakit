import { personName } from '@arrakit/address'
import { daysUntil, memberEmail, signinEmail, toMail } from '@arrakit/emails'
import type { GenericEndpointContext } from 'better-auth'

import { MAGIC_LINK_MINUTES } from './config'
import type { AuthDeps } from './auth'

interface MagicLink {
  email: string
  url: string
  metadata?: Record<string, unknown>
}

/** The invitation a server-sent link is for; metadata from an HTTP request is not trusted. */
function invitationIdOf({ metadata }: MagicLink, ctx: GenericEndpointContext | undefined) {
  if (ctx?.request) return null
  const id = metadata?.invitationId
  return typeof id === 'string' ? id : null
}

export function magicLinkSender(deps: AuthDeps, now: () => Date = () => new Date()) {
  return async (link: MagicLink, ctx?: GenericEndpointContext) => {
    const { email, url } = link
    const invitationId = invitationIdOf(link, ctx)
    const invitation = invitationId ? await deps.data.invitationFor(invitationId, email) : null
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
