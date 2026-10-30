import { describe, expect, it } from 'vitest'

import { APP_NAME } from '../brand'
import { canceledEmail } from './canceled'
import { downgradedEmail } from './downgraded'
import { failedEmail } from './failed'
import { receiptEmail } from './receipt'
import { renewEmail } from './renew'

const organization = { name: 'Acme' }
const app = 'https://app.example.com/app'
const charge = { amount: '€190,00', card: 'Mastercard ending 0005' }

describe('receiptEmail', () => {
  it('confirms the plan, what was paid and when it renews', () => {
    const email = receiptEmail({
      organization,
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
      organization,
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
      organization,
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
      organization,
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
