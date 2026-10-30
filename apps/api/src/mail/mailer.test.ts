import { describe, expect, it, vi } from 'vitest'

import { loadApiEnv } from '../env'
import { createMailer, mailpitAddress, recordingMailer } from './mailer'

const mailerFor = (
  vars: Record<string, string>,
  deps: Partial<Parameters<typeof createMailer>[1]> = {},
) => createMailer(loadApiEnv(vars), { log: () => undefined, ...deps })

const mail = {
  to: 'ana@acme.com',
  subject: 'Your link to sign in to Arrakit',
  html: '<p>hi</p>',
  text: 'Sign in: https://app.example/x',
}

describe('createMailer with RESEND_API_KEY', () => {
  const resend = (status = 200, body = '{"id":"1"}') =>
    vi.fn<typeof fetch>(async () => new Response(body, { status }))

  it('posts the email to Resend with the key and the default sender', async () => {
    const fetch = resend()
    const mailer = mailerFor({ RESEND_API_KEY: 're_test' }, { fetch })

    await mailer.send(mail)

    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.resend.com/emails')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({
      authorization: 'Bearer re_test',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      from: 'Arrakit <hello@example.com>',
      to: ['ana@acme.com'],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    })
  })

  it('sends from MAIL_FROM when given', async () => {
    const fetch = resend()
    const mailer = mailerFor(
      { RESEND_API_KEY: 're_test', MAIL_FROM: 'Team <team@acme.com>' },
      { fetch },
    )
    await mailer.send({ ...mail, to: ['a@acme.com', 'b@acme.com'] })

    const first = JSON.parse(String(fetch.mock.calls[0]![1]?.body))
    expect(first.from).toBe('Team <team@acme.com>')
    expect(first.to).toEqual(['a@acme.com', 'b@acme.com'])
  })

  it('throws when Resend refuses, without the subject or the recipients', async () => {
    const mailer = mailerFor(
      { RESEND_API_KEY: 're_test' },
      { fetch: resend(422, '{"message":"invalid from"}') },
    )
    const error = await mailer.send(mail).catch((err: Error) => err)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(
      '[mail] Resend refused the email: 422 {"message":"invalid from"}',
    )
    expect((error as Error).message).not.toContain('ana@acme.com')
    expect((error as Error).message).not.toContain(mail.subject)
  })
})

describe('createMailer with MAILPIT_URL', () => {
  const mailpit = (status = 200, body = '{"ID":"1"}') =>
    vi.fn<typeof fetch>(async () => new Response(body, { status }))

  it('posts the email to Mailpit with the sender', async () => {
    const fetch = mailpit()
    const mailer = mailerFor({ MAILPIT_URL: 'http://localhost:5025' }, { fetch })

    await mailer.send(mail)

    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('http://localhost:5025/api/v1/send')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      From: { Email: 'hello@example.com', Name: 'Arrakit' },
      To: [{ Email: 'ana@acme.com' }],
      Subject: mail.subject,
      HTML: mail.html,
      Text: mail.text,
    })
  })

  it('prefers Resend when both are set', async () => {
    const fetch = mailpit()
    const mailer = mailerFor(
      { RESEND_API_KEY: 're_test', MAILPIT_URL: 'http://localhost:5025' },
      { fetch },
    )
    await mailer.send(mail)
    expect(fetch.mock.calls[0]![0]).toBe('https://api.resend.com/emails')
  })

  it('throws when Mailpit refuses or is not running', async () => {
    const refused = mailerFor(
      { MAILPIT_URL: 'http://localhost:5025' },
      { fetch: mailpit(400, 'bad') },
    )
    await expect(refused.send(mail)).rejects.toThrow('[mail] Mailpit refused the email: 400 bad')

    const down = mailerFor(
      { MAILPIT_URL: 'http://localhost:5025' },
      { fetch: async () => Promise.reject(new TypeError('fetch failed')) },
    )
    await expect(down.send(mail)).rejects.toThrow(
      '[mail] Mailpit is not reachable at http://localhost:5025',
    )
  })

  it('refuses to start in production without Resend', () => {
    expect(() =>
      mailerFor({ NODE_ENV: 'production', MAILPIT_URL: 'http://localhost:5025' }),
    ).toThrow('[mail] missing env: RESEND_API_KEY')
  })
})

describe('mailpitAddress', () => {
  it('splits a named address and keeps a bare one', () => {
    expect(mailpitAddress('Arrakit <hello@example.com>')).toEqual({
      Email: 'hello@example.com',
      Name: 'Arrakit',
    })
    expect(mailpitAddress('"Acme, Inc" <a@acme.com>')).toEqual({
      Email: 'a@acme.com',
      Name: 'Acme, Inc',
    })
    expect(mailpitAddress('<a@acme.com>')).toEqual({ Email: 'a@acme.com' })
    expect(mailpitAddress('a@acme.com')).toEqual({ Email: 'a@acme.com' })
  })
})

describe('createMailer without RESEND_API_KEY or MAILPIT_URL', () => {
  it('logs one line per mail with the link', async () => {
    const log = vi.fn()
    const mailer = mailerFor({ RESEND_API_KEY: '' }, { log })

    await mailer.send(mail)

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toBe(
      `Neither RESEND_API_KEY nor MAILPIT_URL is set, so nothing is sent. From Arrakit <hello@example.com> to ana@acme.com: ${mail.subject}\n${mail.text}`,
    )
  })

  it('refuses to start in production', () => {
    expect(() => mailerFor({ NODE_ENV: 'production' })).toThrow(
      '[mail] missing env: RESEND_API_KEY (production never logs sign-in links)',
    )
  })
})

describe('recordingMailer', () => {
  it('records every mail', async () => {
    const { mailer, sent } = recordingMailer()
    await mailer.send(mail)
    expect(sent).toEqual([mail])
  })
})
