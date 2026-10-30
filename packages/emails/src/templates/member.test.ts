import { describe, expect, it } from 'vitest'

import { APP_NAME } from '../brand'
import { memberEmail } from './member'

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
