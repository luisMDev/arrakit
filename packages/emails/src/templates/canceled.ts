import { composeEmail } from '../compose'

export interface CanceledEmailInput {
  plan: string
  /** YYYY-MM-DD */
  endsOn: string
  links: { billing: string }
}

export function canceledEmail(input: CanceledEmailInput) {
  return composeEmail({
    subject: `${input.plan} ends on ${input.endsOn}`,
    heading: { lead: `${input.plan} ends`, tail: `on ${input.endsOn}.` },
    blocks: [
      {
        kind: 'paragraph',
        text: 'Until then, nothing changes. After that you move to Free. Your data stays.',
      },
      { kind: 'actions', primary: { label: `Keep ${input.plan}`, href: input.links.billing } },
    ],
    footer: 'Sent to organization admins.',
  })
}
