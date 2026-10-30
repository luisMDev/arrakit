import { normalizeEmail, isAdminRole } from '@arrakit/address'
import {
  type Charge,
  type Mail,
  type RenderedEmail,
  canceledEmail,
  daysUntil as daysUntilDate,
  downgradedEmail,
  failedEmail,
  receiptEmail,
  renewEmail,
  toMail,
} from '@arrakit/emails'
import { PLANS, type Plan } from '@arrakit/plans'

import type { Money } from './stripe-gateway'
import { subscriptionOfLookupKey } from './subscription-plan'

export function recipients(...emails: (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>()
  for (const email of emails) {
    if (!email) continue
    const key = normalizeEmail(email)
    if (key && !seen.has(key)) seen.set(key, email)
  }
  return [...seen.values()]
}

export function chargeOf(money: Money, card: { brand: string; last4: string } | null): Charge {
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

const mailsOf = (email: RenderedEmail, to: string[]): Mail[] =>
  to.map((address) => toMail(email, address))

const billingLink = (webOrigin: string) => `${webOrigin}/app/billing`

export const receiptMails = (input: {
  plan: string
  cycle: 'monthly' | 'yearly'
  charge: Charge
  renewsOn: string
  invoiceUrl: string
  to: string[]
  webOrigin: string
}): Mail[] =>
  mailsOf(
    receiptEmail({
      plan: input.plan,
      billing: input.cycle,
      charge: input.charge,
      renewsOn: input.renewsOn,
      links: { invoice: input.invoiceUrl, billing: billingLink(input.webOrigin) },
    }),
    input.to,
  )

export const canceledMails = (input: {
  plan: string
  endsOn: string
  to: string[]
  webOrigin: string
}): Mail[] =>
  mailsOf(
    canceledEmail({
      plan: input.plan,
      endsOn: input.endsOn,
      links: { billing: billingLink(input.webOrigin) },
    }),
    input.to,
  )

export const failedMails = (input: {
  charge: Charge
  retryInDays: number
  to: string[]
  webOrigin: string
}): Mail[] =>
  mailsOf(
    failedEmail({
      charge: input.charge,
      retryInDays: input.retryInDays,
      links: { billing: billingLink(input.webOrigin) },
    }),
    input.to,
  )

export const downgradedMails = (input: {
  organization: { name: string }
  plan: string
  to: string[]
  webOrigin: string
}): Mail[] =>
  mailsOf(
    downgradedEmail({
      organization: input.organization.name,
      plan: input.plan,
      links: { billing: billingLink(input.webOrigin) },
    }),
    input.to,
  )

export const renewMails = (input: {
  plan: string
  charge: Charge
  renewsOn: string
  daysLeft: number
  to: string[]
  webOrigin: string
}): Mail[] =>
  mailsOf(
    renewEmail({
      plan: input.plan,
      charge: input.charge,
      renewsOn: input.renewsOn,
      daysLeft: input.daysLeft,
      links: { billing: billingLink(input.webOrigin) },
    }),
    input.to,
  )

export const daysUntil = (unixSeconds: number, nowMs: number): number =>
  daysUntilDate(new Date(unixSeconds * 1000), new Date(nowMs))

export const adminsOf = (members: readonly { email: string; role: string }[]): string[] =>
  members.filter((m) => isAdminRole(m.role)).map((m) => m.email)

export function shouldSendReceipt(input: {
  previousLookupKey: string | null
  previousPlan: Plan
  plan: Plan
  lookupKey: string | null
  receiptFor: string | null
}): boolean {
  const current = subscriptionOfLookupKey(input.lookupKey)
  if (!current || current.plan !== input.plan || input.receiptFor === input.lookupKey) return false
  const previous = subscriptionOfLookupKey(input.previousLookupKey)
  const previousPlan = previous?.plan ?? input.previousPlan
  return PLANS.indexOf(current.plan) > PLANS.indexOf(previousPlan)
}

export function cycleReceiptDue(input: {
  lookupKey: string | null
  receiptFor: string | null
}): boolean {
  const current = subscriptionOfLookupKey(input.lookupKey)
  const settled = subscriptionOfLookupKey(input.receiptFor)
  return (
    current?.cycle === 'yearly' && settled?.cycle === 'monthly' && settled.plan === current.plan
  )
}

export const downgradeDue = (input: {
  previousPlan: Plan
  plan: Plan
  cancellationReason: string | null
}): boolean =>
  input.cancellationReason === 'payment_failed' &&
  input.previousPlan !== 'free' &&
  input.plan === 'free'
