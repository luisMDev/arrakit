import { describe, expect, it } from 'vitest'

import { APP_NAME } from './brand'
import {
  actions,
  bullets,
  choices,
  composeEmail,
  link,
  note,
  paragraph,
  quote,
  rows,
  sections,
} from './compose'

describe('composeEmail', () => {
  it('carries the subject and heading in both parts, and no Reply-To unless given', () => {
    const email = composeEmail({
      subject: 'Your link to sign in',
      heading: { lead: 'Sign in', tail: 'to the app.' },
      blocks: [paragraph('The link works once, for 15 minutes.')],
    })

    expect(email.replyTo).toBeNull()
    expect(email.subject).toBe('Your link to sign in')
    expect(email.html).toContain('<html lang="en">')
    expect(email.html).toContain('<h1')
    expect(email.html).toContain('The link works once, for 15 minutes.')
    expect(email.text).toContain('Sign in to the app.')
    expect(email.text).toContain('The link works once, for 15 minutes.')
  })

  it('keeps a Reply-To when given', () => {
    const email = composeEmail({
      subject: 's',
      heading: { lead: 'a', tail: 'b' },
      blocks: [],
      replyTo: 'billing@example.com',
    })
    expect(email.replyTo).toBe('billing@example.com')
  })

  it('puts the product name in the masthead and the footer last in the text', () => {
    const email = composeEmail({
      subject: 'Back on Free',
      heading: { lead: 'Pro ended.', tail: 'You are on Free.' },
      blocks: [paragraph('Your data stays.')],
      footer: ['Sent to organization admins.'],
    })

    expect(email.html).toContain(`>${APP_NAME}</td>`)
    expect(email.text).toMatch(/--\nSent to organization admins\.\n$/)
  })

  it('escapes names in the HTML and keeps them as written in the subject and the text', () => {
    const name = `Ardent & "Co" <O'Neil>`
    const email = composeEmail({
      subject: `Welcome to ${name}`,
      heading: { lead: 'Welcome', tail: `${name}.` },
      blocks: [
        paragraph(['Ask ', link(name, 'https://app.example.com/a?b=1&c=2'), '.']),
        actions({ label: `Open ${name}`, href: 'https://app.example.com/x' }),
        note(`Reply about Q3 <> Q4 for ${name}.`),
      ],
    })

    expect(email.subject).toBe(`Welcome to ${name}`)
    expect(email.html).not.toContain(name)
    expect(email.html).toContain('Ardent &amp; &quot;Co&quot; &lt;O&#39;Neil&gt;')
    expect(email.html).toContain('href="https://app.example.com/a?b=1&amp;c=2"')
    expect(email.html).toContain('Q3 &lt;&gt; Q4')
    expect(email.text).toContain(`Ask ${name} (https://app.example.com/a?b=1&c=2).`)
    expect(email.text).toContain(`Open ${name}: https://app.example.com/x`)
  })

  it('renders every block kind in the text part', () => {
    const email = composeEmail({
      subject: 's',
      heading: { lead: 'Lead', tail: 'tail' },
      blocks: [
        bullets(['one', 'two']),
        rows([['Plan', 'Pro']]),
        sections([{ label: 'Answered', text: 'Yes' }]),
        quote('Hi'),
        choices([
          { label: 'A', href: 'https://a.example' },
          { label: 'B', href: 'https://b.example' },
        ]),
        actions(
          { label: 'Go', href: 'https://go.example' },
          { label: 'Later', href: 'https://later.example' },
        ),
      ],
    })

    expect(email.text).toBe(
      [
        'Lead tail',
        '- one\n- two',
        'Plan: Pro',
        'ANSWERED\nYes',
        '“Hi”',
        'A: https://a.example\nB: https://b.example',
        'Go: https://go.example\nLater: https://later.example',
      ].join('\n\n') + '\n',
    )
  })

  it('refuses a link that is neither https: nor mailto:', () => {
    const withLink = (href: string) => () =>
      composeEmail({
        subject: 'Sign in',
        heading: { lead: 'Sign in', tail: 'to the app.' },
        blocks: [actions({ label: 'Sign in', href })],
      })

    expect(withLink('javascript:alert(1)')).toThrow(/https: or mailto:/)
    expect(withLink('http://app.example.com')).toThrow(/https: or mailto:/)
    expect(withLink('mailto:hello@example.com')).not.toThrow()
    expect(withLink('HTTPS://app.example.com')).not.toThrow()
    expect(withLink('http://localhost:4200/api/auth/x')).not.toThrow()
    expect(withLink('http://127.0.0.1/x')).not.toThrow()
    expect(withLink('http://localhost.evil.com/x')).toThrow(/https: or mailto:/)
  })

  it('checks links inside rich text too', () => {
    expect(() =>
      composeEmail({
        subject: 's',
        heading: { lead: 'a', tail: 'b' },
        blocks: [paragraph([link('x', 'javascript:void(0)')])],
      }),
    ).toThrow(/https: or mailto:/)
  })
})
