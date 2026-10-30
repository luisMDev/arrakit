import { MAGIC_LINK_MINUTES } from './config'
import type { AuthDeps } from './deps'
import { signinEmail } from '@arrakit/emails'

export function magicLinkSender(deps: AuthDeps) {
  return async ({ email, url }: { email: string; url: string }) => {
    const mail = signinEmail({ minutes: MAGIC_LINK_MINUTES, links: { signIn: url } })
    await deps.mailer.send({ to: email, subject: mail.subject, html: mail.html, text: mail.text })
  }
}
