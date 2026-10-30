import { APP_NAME } from '../brand'
import { actions, composeEmail, paragraph } from '../compose'
import { count, fullDay, shortDay } from '../copy'
import type { RenderedEmail } from '../mail'
import type { Charge } from './receipt'

export interface RenewEmailInput {
  plan: string
  charge: Charge
  /** YYYY-MM-DD */
  renewsOn: string
  daysLeft: number
  links: { billing: string }
}

export function renewEmail(input: RenewEmailInput): RenderedEmail {
  return composeEmail({
    subject: `${APP_NAME} ${input.plan} renews on ${shortDay(input.renewsOn)}`,
    heading: { lead: `${input.plan} renews`, tail: `in ${count(input.daysLeft, 'day')}.` },
    blocks: [
      paragraph(`${input.charge.amount} on ${fullDay(input.renewsOn)}, to ${input.charge.card}.`),
      actions({ label: 'Manage plan', href: input.links.billing }),
    ],
    footer: 'Yearly plans only.',
  })
}
