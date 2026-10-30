import { describe, expect, it } from 'vitest'

import { escapeHtml } from './escape'
import { APP_NAME, signinEmail, toMail } from './index'

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
  it('render the sign-in email with the exact link', () => {
    const mail = signinEmail({ minutes: 15, links: { signIn: 'https://app.example/x?a=1&b=2' } })
    expect(mail.subject).toBe('Your link to sign in to Arrakit')
    expect(mail.text).toContain('https://app.example/x?a=1&b=2')
    expect(mail.html).toContain('href="https://app.example/x?a=1&amp;b=2"')
    expect(mail.text).toContain('15 minutes')
  })
})

describe('toMail', () => {
  const rendered = { subject: 's', html: '<p>h</p>', text: 't', replyTo: null }

  it('addresses a rendered email, with no Reply-To unless it has one', () => {
    expect(toMail(rendered, 'ana@acme.com')).toEqual({
      to: 'ana@acme.com',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
    })
    expect(toMail({ ...rendered, replyTo: 'billing@acme.com' }, 'ana@acme.com').replyTo).toBe(
      'billing@acme.com',
    )
  })
})
