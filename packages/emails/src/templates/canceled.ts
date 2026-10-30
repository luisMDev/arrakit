import { actions, composeEmail, paragraph } from '../compose'
import { fullDay } from '../copy'
import type { RenderedEmail } from '../mail'

export interface CanceledEmailInput {
  plan: string
  /** YYYY-MM-DD */
  endsOn: string
  links: { billing: string }
}

export function canceledEmail(input: CanceledEmailInput): RenderedEmail {
  const endsOn = fullDay(input.endsOn)
  return composeEmail({
    subject: `${input.plan} ends on ${endsOn}`,
    heading: { lead: `${input.plan} ends`, tail: `on ${endsOn}.` },
    blocks: [
      paragraph('Until then, nothing changes. After that you move to Free. Your data stays.'),
      actions({ label: `Keep ${input.plan}`, href: input.links.billing }),
    ],
    footer: 'Sent to organization admins.',
  })
}
