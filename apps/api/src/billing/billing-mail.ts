import { normalizeEmail } from '@arrakit/address'
import {
  type Charge,
  type Mail,
  type RenderedEmail,
  canceledEmail,
  downgradedEmail,
  failedEmail,
  receiptEmail,
  renewEmail,
} from '@arrakit/emails'
import { PLANS, type Plan } from '@arrakit/plans'

import type { Money } from './stripe-gateway'
import { subscriptionOfLookupKey } from './subscription-plan'

type Organization = { name: string; slug: string }

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
  to.map((address) => ({
    to: address,
    subject: email.subject,
    html: email.html,
    text: email.text,
    ...(email.replyTo ? { replyTo: email.replyTo } : {}),
  }))

const billingLink = (webOrigin: string) => `${webOrigin}/app/billing`

export const receiptMails = (input: {
  organization: Organization
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
      organization: { name: input.organization.name },
      plan: input.plan,
      billing: input.cycle,
      charge: input.charge,
      renewsOn: input.renewsOn,
      links: { invoice: input.invoiceUrl, billing: billingLink(input.webOrigin) },
    }),
    input.to,
  )

export const canceledMails = (input: {
  organization: Organization
  plan: string
  endsOn: string
  to: string[]
  webOrigin: string
}): Mail[] =>
  mailsOf(
    canceledEmail({
      organization: { name: input.organization.name },
      plan: input.plan,
      endsOn: input.endsOn,
      links: { billing: billingLink(input.webOrigin) },
    }),
    input.to,
  )

export const failedMails = (input: {
  organization: Organization
  charge: Charge
  retryInDays: number
  to: string[]
  webOrigin: string
}): Mail[] =>
  mailsOf(
    failedEmail({
      organization: { name: input.organization.name },
      charge: input.charge,
      retryInDays: input.retryInDays,
      links: { billing: billingLink(input.webOrigin) },
    }),
    input.to,
  )

export const downgradedMails = (input: {
  organization: Organization
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
  organization: Organization
  plan: string
  charge: Charge
  renewsOn: string
  daysLeft: number
  to: string[]
  webOrigin: string
}): Mail[] =>
  mailsOf(
    renewEmail({
      organization: { name: input.organization.name },
      plan: input.plan,
      charge: input.charge,
      renewsOn: input.renewsOn,
      daysLeft: input.daysLeft,
      links: { billing: billingLink(input.webOrigin) },
    }),
    input.to,
  )

export const daysUntil = (unixSeconds: number, nowMs: number): number =>
  Math.max(1, Math.ceil((unixSeconds * 1000 - nowMs) / 86_400_000))

export const adminsOf = (members: readonly { email: string; role: string }[]): string[] =>
  members.filter((m) => m.role === 'owner' || m.role === 'admin').map((m) => m.email)

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
