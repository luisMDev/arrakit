import { receiptEmail } from '@arrakit/emails'
import { describe, expect, it, vi } from 'vitest'

import {
  adminsOf,
  billingLink,
  chargeOf,
  daysUntil,
  downgradeDue,
  mailsOf,
  recipients,
  sendMails,
} from './billing-mail'

describe('recipients', () => {
  it('drops empty entries and keeps the first spelling of each address', () => {
    expect(
      recipients('Ana@Organization.com', 'ana@organization.com', '', null, 'bill@organization.com'),
    ).toEqual(['Ana@Organization.com', 'bill@organization.com'])
  })
})

describe('chargeOf', () => {
  const visa = { brand: 'visa', last4: '4242' }

  it.each([
    [143000, 'usd', '$1,430'],
    [1499, 'usd', '$14.99'],
    [143000, 'eur', '€1,430'],
    [1430, 'jpy', '¥1,430'],
  ])('writes %i %s as %s', (amount, currency, written) => {
    expect(chargeOf({ amount, currency }, visa).amount).toBe(written)
  })

  it('names the card by brand and last four digits', () => {
    expect(chargeOf({ amount: 143000, currency: 'usd' }, visa).card).toBe('Visa ending 4242')
  })

  it('gives a neutral label when Stripe holds no card', () => {
    expect(chargeOf({ amount: 143000, currency: 'usd' }, null).card).toBe('your card')
  })
})

describe('daysUntil', () => {
  const now = Date.UTC(2026, 9, 19, 12)
  const at = (ms: number) => Math.floor(ms / 1000)

  it.each([
    ['3 days ahead', at(now + 3 * 86_400_000), 3],
    ['1 hour ahead', at(now + 3_600_000), 1],
    ['already past', at(now - 3_600_000), 1],
    ['2.1 days ahead', at(now + 2.1 * 86_400_000), 3],
  ])('%s gives %i', (_, nextAttempt, days) => {
    expect(daysUntil(nextAttempt, now)).toBe(days)
  })
})

describe('adminsOf', () => {
  it("keeps the owner's and the admins' emails, never a member's", () => {
    const members = [
      { email: 'owner@cierzo.vc', role: 'owner' },
      { email: 'admin@cierzo.vc', role: 'admin' },
      { email: 'member@cierzo.vc', role: 'member' },
    ] as const
    expect(adminsOf(members)).toEqual(['owner@cierzo.vc', 'admin@cierzo.vc'])
  })
})

describe('downgradeDue', () => {
  it.each([
    ['Pro dropped to Free after the failed retries', 'pro', 'free', 'payment_failed', true],
    ['Team dropped to Free after the failed retries', 'team', 'free', 'payment_failed', true],
    ['an admin cancelled it', 'pro', 'free', 'cancellation_requested', false],
    ['a dispute ended it', 'pro', 'free', 'payment_disputed', false],
    ['no reason given', 'pro', 'free', null, false],
    ['a replay, the organization already on Free', 'free', 'free', 'payment_failed', false],
    ['still on Pro', 'pro', 'pro', 'payment_failed', false],
    ['Team to Pro', 'team', 'pro', 'payment_failed', false],
    ['Free to Pro', 'free', 'pro', 'payment_failed', false],
  ] as const)('%s', (_, previousPlan, plan, cancellationReason, expected) => {
    expect(downgradeDue({ previousPlan, plan, cancellationReason })).toBe(expected)
  })
})

describe('mailsOf', () => {
  it('addresses one copy of the email to each recipient', () => {
    const email = receiptEmail({
      plan: 'Pro',
      billing: 'yearly',
      charge: { amount: '$1,430', card: 'Visa ending 4242' },
      renewsOn: '2027-01-01',
      links: {
        invoice: 'https://pay.stripe.com/invoice/in_1/pdf',
        billing: billingLink('https://app.example.com'),
      },
    })
    const mails = mailsOf(email, ['ana@cierzo.vc', 'bill@cierzo.vc'])
    expect(mails.map((mail) => mail.to)).toEqual(['ana@cierzo.vc', 'bill@cierzo.vc'])
    for (const mail of mails) {
      expect(mail).toMatchObject({ subject: email.subject, html: email.html, text: email.text })
    }
    expect(email.text).toContain('https://app.example.com/app/billing')
  })
})

describe('sendMails', () => {
  it('sends every mail and reports each failure without stopping the others', async () => {
    const down = new Error('mail down')
    const send = vi.fn(async (mail: { to: string | string[] }) => {
      if (mail.to === 'b@cierzo.vc') throw down
    })
    const onFailure = vi.fn()
    const mail = { subject: 's', html: 'h', text: 't' }
    await sendMails(
      { send },
      ['a@cierzo.vc', 'b@cierzo.vc', 'c@cierzo.vc'].map((to) => ({ ...mail, to })),
      onFailure,
    )
    expect(send).toHaveBeenCalledTimes(3)
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(down)
  })
})
