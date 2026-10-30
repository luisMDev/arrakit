import { type EmailOrganization, actions, composeEmail, paragraph } from '../compose'
import { count } from '../copy'
import type { RenderedEmail } from '../mail'
import type { Charge } from './receipt'

export interface FailedEmailInput {
  organization?: EmailOrganization
  charge: Charge
  retryInDays: number
  links: { billing: string }
}

export function failedEmail(input: FailedEmailInput): RenderedEmail {
  return composeEmail({
    ...(input.organization ? { organization: input.organization } : {}),
    subject: "Your payment didn't go through",
    heading: { lead: 'Your payment', tail: "didn't go through." },
    blocks: [
      paragraph(
        `We couldn't charge ${input.charge.amount} to ${input.charge.card}. We'll try again in ${count(input.retryInDays, 'day')}. Your plan keeps working until then.`,
      ),
      actions({ label: 'Update card', href: input.links.billing }),
    ],
    footer: 'Sent to the billing email and organization admins.',
  })
}
