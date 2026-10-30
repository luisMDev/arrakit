import { describe, expect, it } from 'vitest'

import {
  APP_NAME,
  canceledEmail,
  downgradedEmail,
  failedEmail,
  memberEmail,
  receiptEmail,
  renewEmail,
  signinEmail,
  toMail,
} from './index'

const origin = 'https://app.example.com'

describe('signinEmail (MailSignin)', () => {
  it('sends a one-time link that expires', () => {
    const email = signinEmail({ minutes: 15, links: { signIn: `${origin}/auth/link?t=abc&x=1` } })

    expect(email.subject).toBe(`Your link to sign in to ${APP_NAME}`)
    expect(email.text).toContain(`Sign in to ${APP_NAME}.`)
    expect(email.text).toContain('The link works once, for 15 minutes.')
    expect(email.text).toContain(`Sign in: ${origin}/auth/link?t=abc&x=1`)
    expect(email.html).toContain(`href="${origin}/auth/link?t=abc&amp;x=1"`)
    expect(email.text).toContain("Didn't ask for this? Ignore this email.")
  })

  it('counts a single minute', () => {
    expect(signinEmail({ minutes: 1, links: { signIn: origin + '/' } }).text).toContain(
      'for 1 minute.',
    )
  })
})

const join =
  'https://app.example.com/api/auth/magic-link/verify?token=AbC123xYz&callbackURL=https%3A%2F%2Fapp.example.com%2Fjoin%2Finv-1'

const input = {
  organization: 'Acme',
  inviter: 'Ana Pérez Soler',
  expiresInDays: 7,
  links: { join },
}

describe('memberEmail (MailMember)', () => {
  it("is sent in the inviter's first name, to join the organization", () => {
    const email = memberEmail(input)

    expect(email.subject).toBe(`Ana invited you to Acme on ${APP_NAME}`)
    expect(email.text).toContain('Join Acme')
    expect(email.text).toContain(`on ${APP_NAME}.`)
    expect(email.text).toContain('Ana Pérez Soler invited you to work with them in Acme.')
  })

  it('carries the magic link and the expiry', () => {
    const email = memberEmail(input)

    expect(email.text).toContain(`Join Acme: ${join}`)
    expect(email.html).toContain(`href="${join.replaceAll('&', '&amp;')}"`)
    expect(email.text).toContain('The invite expires in 7 days.')
  })

  it('counts a single day', () => {
    expect(memberEmail({ ...input, expiresInDays: 1 }).text).toContain(
      'The invite expires in 1 day.',
    )
  })

  it('takes the inviter label as given (the email local part when they have no name)', () => {
    expect(memberEmail({ ...input, inviter: 'jane' }).subject).toBe(
      `jane invited you to Acme on ${APP_NAME}`,
    )
  })
})

const app = 'https://app.example.com/app'
const charge = { amount: '€190,00', card: 'Mastercard ending 0005' }

describe('receiptEmail', () => {
  it('confirms the plan, what was paid and when it renews', () => {
    const email = receiptEmail({
      plan: 'Pro',
      billing: 'yearly',
      charge,
      renewsOn: '2027-10-09',
      links: { invoice: `${app}/billing/invoices/INV-1`, billing: `${app}/billing` },
    })
    expect(email.subject).toBe(`You're on ${APP_NAME} Pro`)
    expect(email.text).toContain('Plan: Pro · yearly')
    expect(email.text).toContain('Paid: €190,00 · Mastercard ending 0005')
    expect(email.text).toContain('Renews: Oct 9, 2027')
    expect(email.text).toContain(`${app}/billing/invoices/INV-1`)
    expect(email.text).toContain(`${app}/billing`)
  })
})

describe('renewEmail', () => {
  it('says what renews, when and on which card', () => {
    const email = renewEmail({
      plan: 'Pro',
      charge,
      renewsOn: '2027-10-09',
      daysLeft: 7,
      links: { billing: `${app}/billing` },
    })
    expect(email.subject).toBe(`${APP_NAME} Pro renews on Oct 9`)
    expect(email.text).toContain('Pro renews in 7 days.')
    expect(email.text).toContain('€190,00 on Oct 9, 2027, to Mastercard ending 0005.')
  })
})

describe('failedEmail', () => {
  it('says the charge failed and when it is tried again', () => {
    const email = failedEmail({
      charge,
      retryInDays: 3,
      links: { billing: `${app}/billing` },
    })
    expect(email.text).toContain("We'll try again in 3 days.")
    expect(email.text).toContain(`${app}/billing`)
  })
})

describe('canceledEmail', () => {
  it('names the last day of the plan', () => {
    const email = canceledEmail({
      plan: 'Team',
      endsOn: '2026-11-30',
      links: { billing: `${app}/billing` },
    })
    expect(email.subject).toBe('Team ends on Nov 30, 2026')
    expect(email.text).toContain('Keep Team')
    expect(email.text).toContain(`${app}/billing`)
  })
})

describe('downgradedEmail', () => {
  it('says the organization is back on Free', () => {
    const email = downgradedEmail({
      organization: 'Acme',
      plan: 'Pro',
      links: { billing: `${app}/billing` },
    })
    expect(email.subject).toBe('Acme is back on Free')
    expect(email.text).toContain('Pro ended.')
    expect(email.text).toContain(`${app}/billing`)
  })
})

describe('toMail', () => {
  it('addresses a rendered email', () => {
    expect(toMail({ subject: 's', html: '<p>h</p>', text: 't' }, 'ana@acme.com')).toEqual({
      to: 'ana@acme.com',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
    })
  })
})
