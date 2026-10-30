import { actions, composeEmail, paragraph } from '../compose'
import type { RenderedEmail } from '../mail'

export interface DowngradedEmailInput {
  plan: string
  organization: string
  links: { billing: string }
}

export function downgradedEmail(input: DowngradedEmailInput): RenderedEmail {
  return composeEmail({
    subject: `${input.organization} is back on Free`,
    heading: { lead: `${input.plan} ended.`, tail: `${input.organization} is on Free.` },
    blocks: [
      paragraph(
        `We couldn't charge your card after a week of tries, so ${input.plan} has ended. Your data stays.`,
      ),
      actions({ label: 'Choose a plan', href: input.links.billing }),
    ],
    footer: 'Sent to the billing email and organization admins.',
  })
}
