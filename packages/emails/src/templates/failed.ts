import { composeEmail } from '../compose'
import { count } from '../copy'

export interface FailedEmailInput {
  charge: { amount: string; card: string }
  retryInDays: number
  links: { billing: string }
}

export function failedEmail(input: FailedEmailInput) {
  return composeEmail({
    subject: "Your payment didn't go through",
    heading: { lead: 'Your payment', tail: "didn't go through." },
    blocks: [
      {
        kind: 'paragraph',
        text: `We couldn't charge ${input.charge.amount} to ${input.charge.card}. We'll try again in ${count(input.retryInDays, 'day')}. Your plan keeps working until then.`,
      },
      { kind: 'actions', primary: { label: 'Update card', href: input.links.billing } },
    ],
    footer: 'Sent to the billing email and organization admins.',
  })
}
