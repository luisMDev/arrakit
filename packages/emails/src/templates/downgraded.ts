import { composeEmail } from '../compose'

export interface DowngradedEmailInput {
  plan: string
  organization: string
  links: { billing: string }
}

export function downgradedEmail(input: DowngradedEmailInput) {
  return composeEmail({
    subject: `${input.organization} is back on Free`,
    heading: { lead: `${input.plan} ended.`, tail: `${input.organization} is on Free.` },
    blocks: [
      {
        kind: 'paragraph',
        text: `We couldn't charge your card after a week of tries, so ${input.plan} has ended. Your data stays.`,
      },
      { kind: 'actions', primary: { label: 'Choose a plan', href: input.links.billing } },
    ],
    footer: 'Sent to the billing email and organization admins.',
  })
}
