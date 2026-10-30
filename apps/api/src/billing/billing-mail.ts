import { normalizeEmail } from '@arrakit/address'
import { allows, permissionsOf } from '@arrakit/auth/permissions'
import { type Charge, type Mailer, type RenderedEmail, toMail } from '@arrakit/emails'
import type { Plan } from '@arrakit/plans'

import type { Card, Money } from './stripe-gateway'

export function recipients(...emails: (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>()
  for (const email of emails) {
    if (!email) continue
    const key = normalizeEmail(email)
    if (key && !seen.has(key)) seen.set(key, email)
  }
  return [...seen.values()]
}

export function chargeOf(money: Money, card: Card | null): Charge {
  const currency = money.currency.toUpperCase()
  const digits =
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  const value = money.amount / 10 ** digits
  const shown = Number.isInteger(value) ? 0 : digits
  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: shown,
    maximumFractionDigits: shown,
  }).format(value)
  const brand = card && card.brand.charAt(0).toUpperCase() + card.brand.slice(1)
  return { amount, card: card ? `${brand} ending ${card.last4}` : 'your card' }
}

export const billingLink = (webOrigin: string) => `${webOrigin}/app/billing`

/** Sends `email` to each address; each one that fails goes to `onFailure` and never stops the others. */
export async function sendMails(
  mailer: Mailer,
  email: RenderedEmail,
  to: string[],
  onFailure: (err: unknown) => void,
): Promise<void> {
  const sent = await Promise.allSettled(to.map((address) => mailer.send(toMail(email, address))))
  for (const result of sent) {
    if (result.status === 'rejected') onFailure(result.reason)
  }
}

/** The members whose static role manages billing (owners and admins). */
export const adminsOf = (members: readonly { email: string; role: string }[]): string[] =>
  members.filter((m) => allows(permissionsOf(m.role), { billing: ['manage'] })).map((m) => m.email)

export const downgradeDue = (input: {
  previousPlan: Plan
  plan: Plan
  cancellationReason: string | null
}): boolean =>
  input.cancellationReason === 'payment_failed' &&
  input.previousPlan !== 'free' &&
  input.plan === 'free'
