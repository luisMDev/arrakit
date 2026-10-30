import { describe, expect, it } from 'vitest'

import { APP_NAME, escapeHtml } from './index'

describe('emails package', () => {
  it('has the product name in one place', () => {
    expect(APP_NAME).toBe('Arrakit')
  })

  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    )
  })
})

describe('templates', () => {
  it('render the sign-in email with the exact link', async () => {
    const { signinEmail } = await import('./index')
    const mail = signinEmail({ minutes: 15, links: { signIn: 'https://app.example/x?a=1&b=2' } })
    expect(mail.subject).toBe('Your link to sign in to Arrakit')
    expect(mail.text).toContain('https://app.example/x?a=1&b=2')
    expect(mail.html).toContain('href="https://app.example/x?a=1&amp;b=2"')
    expect(mail.text).toContain('15 minutes')
  })
})
