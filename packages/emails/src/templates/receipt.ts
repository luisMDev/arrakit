import { APP_NAME } from '../brand'
import { composeEmail } from '../compose'

export interface ReceiptEmailInput {
  plan: string
  billing: string
  charge: { amount: string; card: string }
  /** YYYY-MM-DD */
  renewsOn: string
  links: { invoice: string; billing: string }
}

export function receiptEmail(input: ReceiptEmailInput) {
  return composeEmail({
    subject: `You're on ${APP_NAME} ${input.plan}`,
    heading: { lead: `You're on ${input.plan}.`, tail: 'Thanks for paying.' },
    blocks: [
      {
        kind: 'rows',
        rows: [
          ['Plan', `${input.plan} · ${input.billing}`],
          ['Paid', `${input.charge.amount} · ${input.charge.card}`],
          ['Renews', input.renewsOn],
        ],
      },
      {
        kind: 'actions',
        primary: { label: 'Download invoice', href: input.links.invoice },
        secondary: { label: 'Manage plan', href: input.links.billing },
      },
    ],
    footer: 'Sent to you and the billing email.',
  })
}
