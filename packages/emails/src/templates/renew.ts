import { APP_NAME } from '../brand'
import { composeEmail } from '../compose'
import { count } from '../copy'

export interface RenewEmailInput {
  plan: string
  charge: { amount: string; card: string }
  /** YYYY-MM-DD */
  renewsOn: string
  daysLeft: number
  links: { billing: string }
}

export function renewEmail(input: RenewEmailInput) {
  return composeEmail({
    subject: `${APP_NAME} ${input.plan} renews on ${input.renewsOn}`,
    heading: { lead: `${input.plan} renews`, tail: `in ${count(input.daysLeft, 'day')}.` },
    blocks: [
      {
        kind: 'paragraph',
        text: `${input.charge.amount} on ${input.renewsOn}, to ${input.charge.card}.`,
      },
      { kind: 'actions', primary: { label: 'Manage plan', href: input.links.billing } },
    ],
    footer: 'Yearly plans only.',
  })
}
