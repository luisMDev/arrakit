import { APP_NAME } from '../brand'
import { composeEmail } from '../compose'
import { count } from '../copy'

export interface SigninEmailInput {
  minutes: number
  links: { signIn: string }
}

export function signinEmail({ minutes, links }: SigninEmailInput) {
  return composeEmail({
    subject: `Your link to sign in to ${APP_NAME}`,
    heading: { lead: 'Sign in', tail: `to ${APP_NAME}.` },
    blocks: [
      { kind: 'paragraph', text: `The link works once, for ${count(minutes, 'minute')}.` },
      { kind: 'actions', primary: { label: 'Sign in', href: links.signIn } },
      { kind: 'note', text: "Didn't ask for this? Ignore this email." },
    ],
  })
}
