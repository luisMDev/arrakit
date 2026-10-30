import { APP_NAME } from '../brand'
import { composeEmail } from '../compose'
import { count, firstName } from '../copy'

export interface MemberEmailInput {
  organization: { name: string }
  /** Display name (trimmed name, or the email local part). */
  inviter: string
  expiresInDays: number
  links: { join: string }
}

export function memberEmail({ organization, inviter, expiresInDays, links }: MemberEmailInput) {
  return composeEmail({
    organization,
    subject: `${firstName(inviter)} invited you to ${organization.name} on ${APP_NAME}`,
    heading: { lead: `Join ${organization.name}`, tail: `on ${APP_NAME}.` },
    blocks: [
      {
        kind: 'paragraph',
        text: `${inviter} invited you to work with them in ${organization.name}.`,
      },
      { kind: 'actions', primary: { label: `Join ${organization.name}`, href: links.join } },
      { kind: 'note', text: `The invite expires in ${count(expiresInDays, 'day')}.` },
    ],
  })
}
