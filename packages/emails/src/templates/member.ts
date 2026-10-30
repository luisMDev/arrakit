import { APP_NAME } from '../brand'
import { actions, composeEmail, note, paragraph } from '../compose'
import { count, firstName } from '../copy'
import type { RenderedEmail } from '../mail'

export interface MemberEmailInput {
  organization: string
  /** Display name (trimmed name, or the email local part). */
  inviter: string
  expiresInDays: number
  links: { join: string }
}

export function memberEmail({
  organization,
  inviter,
  expiresInDays,
  links,
}: MemberEmailInput): RenderedEmail {
  return composeEmail({
    subject: `${firstName(inviter)} invited you to ${organization} on ${APP_NAME}`,
    heading: { lead: `Join ${organization}`, tail: `on ${APP_NAME}.` },
    blocks: [
      paragraph(`${inviter} invited you to work with them in ${organization}.`),
      actions({ label: `Join ${organization}`, href: links.join }),
      note(`The invite expires in ${count(expiresInDays, 'day')}.`),
    ],
  })
}
