import { describe, expect, it } from 'vitest'
import { failedEmail, receiptEmail } from '@arrakit/emails'
import {
  adminsOf,
  chargeOf,
  cycleReceiptDue,
  downgradeDue,
  downgradedMails,
  failedMails,
  receiptMails,
  recipients,
  renewMails,
  daysUntil,
  shouldSendReceipt,
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

describe('receiptMails', () => {
  const input = {
    organization: { name: 'Cierzo Ventures', slug: 'cierzo' },
    plan: 'Pro',
    cycle: 'yearly' as const,
    charge: { amount: '$1,430', card: 'Visa ending 4242' },
    renewsOn: '2027-01-01',
    invoiceUrl: 'https://pay.stripe.com/invoice/in_1/pdf',
    webOrigin: 'https://app.example.com',
  }

  it('sends the receipt to each recipient, with the plan link', () => {
    const mails = receiptMails({ ...input, to: ['ana@cierzo.vc', 'bill@cierzo.vc'] })
    const email = receiptEmail({
      organization: { name: 'Cierzo Ventures' },
      plan: 'Pro',
      billing: 'yearly',
      charge: input.charge,
      renewsOn: input.renewsOn,
      links: { invoice: input.invoiceUrl, billing: 'https://app.example.com/app/billing' },
    })

    expect(mails.map((mail) => mail.to)).toEqual(['ana@cierzo.vc', 'bill@cierzo.vc'])
    for (const mail of mails) {
      expect(mail).toMatchObject({ subject: email.subject, html: email.html, text: email.text })
    }
    expect(email.text).toContain('https://app.example.com/app/billing')
  })
})

describe('shouldSendReceipt', () => {
  it.each([
    ['free to pro_monthly', null, 'free', 'pro', 'pro_monthly', null, true],
    [
      'pro_yearly to team_monthly',
      'pro_yearly',
      'team',
      'team',
      'team_monthly',
      'pro_yearly',
      true,
    ],
    ['pro_monthly to pro_yearly', 'pro_monthly', 'pro', 'pro', 'pro_yearly', 'pro_monthly', false],
    [
      'pro_monthly to team_yearly',
      'pro_monthly',
      'pro',
      'team',
      'team_yearly',
      'pro_monthly',
      true,
    ],
    ['free to pro_yearly', null, 'free', 'pro', 'pro_yearly', null, true],
    ['team_yearly to pro_yearly', 'team_yearly', 'team', 'pro', 'pro_yearly', 'team_yearly', false],
    ['a monthly renewal', 'pro_monthly', 'pro', 'pro', 'pro_monthly', null, false],
    ['a yearly renewal', 'pro_yearly', 'pro', 'pro', 'pro_yearly', null, false],
    ['pro_yearly to pro_monthly', 'pro_yearly', 'pro', 'pro', 'pro_monthly', 'pro_yearly', false],
    [
      'a replay of the move to pro_yearly',
      'pro_monthly',
      'pro',
      'pro',
      'pro_yearly',
      'pro_yearly',
      false,
    ],
    ['a replay of the first payment', null, 'free', 'pro', 'pro_yearly', 'pro_yearly', false],
    [
      'no previous price on an organization already on pro',
      null,
      'pro',
      'pro',
      'pro_yearly',
      null,
      false,
    ],
    ['a subscription with no price', null, 'free', 'pro', null, null, false],
    ['a cancelled subscription', null, 'pro', 'free', 'pro_yearly', null, false],
  ] as const)('%s', (_, previousLookupKey, previousPlan, plan, lookupKey, receiptFor, expected) => {
    expect(
      shouldSendReceipt({ previousLookupKey, previousPlan, plan, lookupKey, receiptFor }),
    ).toBe(expected)
  })
})

describe('cycleReceiptDue', () => {
  it.each([
    ['the yearly invoice of a move from pro_monthly', 'pro_monthly', 'pro_yearly', true],
    ['a yearly renewal', 'pro_yearly', 'pro_yearly', false],
    ['a subscription never settled', null, 'pro_yearly', false],
    ['another plan settled before', 'team_monthly', 'pro_yearly', false],
    ['a monthly renewal', 'pro_monthly', 'pro_monthly', false],
  ] as const)('%s', (_, receiptFor, lookupKey, expected) => {
    expect(cycleReceiptDue({ lookupKey, receiptFor })).toBe(expected)
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

describe('failedMails', () => {
  it('sends the failed payment to each recipient, with the amount, the card, the days and the billing link', () => {
    const mails = failedMails({
      organization: { name: 'Cierzo Ventures', slug: 'cierzo' },
      charge: { amount: '$1,430', card: 'Visa ending 4242' },
      retryInDays: 3,
      to: ['bill@cierzo.vc', 'ana@cierzo.vc'],
      webOrigin: 'https://app.example.com',
    })
    const email = failedEmail({
      organization: { name: 'Cierzo Ventures' },
      charge: { amount: '$1,430', card: 'Visa ending 4242' },
      retryInDays: 3,
      links: { billing: 'https://app.example.com/app/billing' },
    })

    expect(mails.map((mail) => mail.to)).toEqual(['bill@cierzo.vc', 'ana@cierzo.vc'])
    for (const mail of mails) {
      expect(mail).toMatchObject({ subject: email.subject, html: email.html, text: email.text })
    }
    expect(email.text).toContain('$1,430')
    expect(email.text).toContain('Visa ending 4242')
    expect(email.text).toContain('3 days')
    expect(email.text).toContain('https://app.example.com/app/billing')
  })
})

describe('renewMails', () => {
  it('sends the renewal notice with the renewal day, the amount and the plan link', () => {
    const mails = renewMails({
      organization: { name: 'Cierzo Ventures', slug: 'cierzo' },
      plan: 'Pro',
      charge: { amount: '$1,430', card: 'Visa ending 4242' },
      renewsOn: '2027-10-04',
      daysLeft: 7,
      to: ['bill@cierzo.vc'],
      webOrigin: 'https://app.example.com',
    })

    expect(mails.map((mail) => mail.to)).toEqual(['bill@cierzo.vc'])
    const text = mails[0]?.text ?? ''
    expect(text).toContain('$1,430')
    expect(text).toContain('7 days')
    expect(text).toContain('Oct 4, 2027')
    expect(text).toContain('https://app.example.com/app/billing')
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

describe('downgradedMails', () => {
  it('tells each recipient the organization is back on Free, with the plan that ended and the billing link', () => {
    const mails = downgradedMails({
      organization: { name: 'Cierzo Ventures', slug: 'cierzo' },
      plan: 'Pro',
      to: ['bill@cierzo.vc', 'ana@cierzo.vc'],
      webOrigin: 'https://app.example.com',
    })

    expect(mails.map((mail) => mail.to)).toEqual(['bill@cierzo.vc', 'ana@cierzo.vc'])
    for (const mail of mails) {
      expect(mail.subject).toBe('Cierzo Ventures is back on Free')
      expect(mail.text).toContain('Pro ended.')
      expect(mail.text).toContain('https://app.example.com/app/billing')
    }
  })
})
