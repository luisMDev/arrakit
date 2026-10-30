import { describe, expect, it } from 'vitest'

import { APP_NAME } from '../brand'
import { signinEmail } from './signin'

const app = 'https://app.example.com'

describe('signinEmail (MailSignin)', () => {
  it('sends a one-time link that expires', () => {
    const email = signinEmail({ minutes: 15, links: { signIn: `${app}/auth/link?t=abc&x=1` } })

    expect(email.replyTo).toBeNull()
    expect(email.subject).toBe(`Your link to sign in to ${APP_NAME}`)
    expect(email.text).toContain(`Sign in to ${APP_NAME}.`)
    expect(email.text).toContain('The link works once, for 15 minutes.')
    expect(email.text).toContain(`Sign in: ${app}/auth/link?t=abc&x=1`)
    expect(email.html).toContain(`href="${app}/auth/link?t=abc&amp;x=1"`)
    expect(email.text).toContain("Didn't ask for this? Ignore this email.")
  })

  it('counts a single minute', () => {
    expect(signinEmail({ minutes: 1, links: { signIn: app + '/' } }).text).toContain(
      'for 1 minute.',
    )
  })
})
