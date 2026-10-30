import { APP_NAME } from '../brand'
import { actions, composeEmail, rows } from '../compose'
import { fullDay } from '../copy'
import type { RenderedEmail } from '../mail'

export interface Charge {
  readonly amount: string
  readonly card: string
}

export interface ReceiptEmailInput {
  plan: string
  billing: 'monthly' | 'yearly'
  charge: Charge
  /** YYYY-MM-DD */
  renewsOn: string
  links: { invoice: string; billing: string }
}

export function receiptEmail(input: ReceiptEmailInput): RenderedEmail {
  return composeEmail({
    subject: `You're on ${APP_NAME} ${input.plan}`,
    heading: { lead: `You're on ${input.plan}.`, tail: 'Thanks for paying.' },
    blocks: [
      rows([
        ['Plan', `${input.plan} · ${input.billing}`],
        ['Paid', `${input.charge.amount} · ${input.charge.card}`],
        ['Renews', fullDay(input.renewsOn)],
      ]),
      actions(
        { label: 'Download invoice', href: input.links.invoice },
        { label: 'Manage plan', href: input.links.billing },
      ),
    ],
    footer: 'Sent to the billing email.',
  })
}
