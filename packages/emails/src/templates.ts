import { actions, composeEmail, note, paragraph, rows } from './compose'
import { count, firstName, fullDay, shortDay } from './copy'
import { APP_NAME, type RenderedEmail } from './index'

export function signinEmail({
  minutes,
  links,
}: {
  minutes: number
  links: { signIn: string }
}): RenderedEmail {
  return composeEmail({
    subject: `Your link to sign in to ${APP_NAME}`,
    heading: { lead: 'Sign in', tail: `to ${APP_NAME}.` },
    blocks: [
      paragraph(`The link works once, for ${count(minutes, 'minute')}.`),
      actions({ label: 'Sign in', href: links.signIn }),
      note("Didn't ask for this? Ignore this email."),
    ],
  })
}

export function memberEmail({
  organization,
  inviter,
  expiresInDays,
  links,
}: {
  organization: string
  /** Display name (trimmed name, or the email local part). */
  inviter: string
  expiresInDays: number
  links: { join: string }
}): RenderedEmail {
  return composeEmail({
    subject: `${firstName(inviter)} invited you to ${organization} on ${APP_NAME}`,
    heading: { lead: `Join ${organization}`, tail: `on ${APP_NAME}.` },
    blocks: [
      paragraph(`${inviter} invited you to work with them in ${organization}.`),
      actions({ label: `Join ${organization}`, href: links.join }),
      note(`The invite expires in ${count(expiresInDays, 'day')}.`),
    ],
  })
}

export interface Charge {
  readonly amount: string
  readonly card: string
}

export function receiptEmail(input: {
  plan: string
  billing: 'monthly' | 'yearly'
  charge: Charge
  /** YYYY-MM-DD */
  renewsOn: string
  links: { invoice: string; billing: string }
}): RenderedEmail {
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

export function renewEmail(input: {
  plan: string
  charge: Charge
  /** YYYY-MM-DD */
  renewsOn: string
  daysLeft: number
  links: { billing: string }
}): RenderedEmail {
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

export function failedEmail(input: {
  charge: Charge
  retryInDays: number
  links: { billing: string }
}): RenderedEmail {
  return composeEmail({
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

export function canceledEmail(input: {
  plan: string
  /** YYYY-MM-DD */
  endsOn: string
  links: { billing: string }
}): RenderedEmail {
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

export function downgradedEmail(input: {
  plan: string
  organization: string
  links: { billing: string }
}): RenderedEmail {
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
