import { APP_NAME } from '../brand'
import { actions, composeEmail, note, paragraph } from '../compose'
import { count } from '../copy'
import type { RenderedEmail } from '../mail'

export interface SigninEmailInput {
  minutes: number
  links: { signIn: string }
}

export function signinEmail({ minutes, links }: SigninEmailInput): RenderedEmail {
  return composeEmail({
    subject: `Your link to sign in to ${APP_NAME}`,
    heading: { lead: 'Sign in', tail: `to ${APP_NAME}.` },
    blocks: [
      paragraph(`The link works once, for ${count(minutes, 'minute')}.`),
      actions({ label: 'Sign in', href: links.signIn }),
      note("Didn't ask for this? Ignore this email."),
    ],
  })
}
