import { describe, expect, it, vi } from 'vitest'

import { createMailer, recordingMailer } from './mailer'

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
    const { mailer, outbox } = createMailer({ RESEND_API_KEY: 're_test' }, { fetch })
    expect(outbox).toBeUndefined()

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

  it('sends MAIL_FROM, Reply-To and Cc only when given', async () => {
    const fetch = resend()
    const { mailer } = createMailer(
      { RESEND_API_KEY: 're_test', MAIL_FROM: 'Team <team@acme.com>' },
      { fetch },
    )
    await mailer.send({ ...mail, to: ['a@acme.com', 'b@acme.com'], cc: [], replyTo: '' })
    await mailer.send({ ...mail, cc: ['c@acme.com'], replyTo: 'billing@acme.com' })

    const first = JSON.parse(String(fetch.mock.calls[0]![1]?.body))
    expect(first.from).toBe('Team <team@acme.com>')
    expect(first.to).toEqual(['a@acme.com', 'b@acme.com'])
    expect(first).not.toHaveProperty('cc')
    expect(first).not.toHaveProperty('reply_to')
    const second = JSON.parse(String(fetch.mock.calls[1]![1]?.body))
    expect(second.cc).toEqual(['c@acme.com'])
    expect(second.reply_to).toEqual(['billing@acme.com'])
  })

  it('throws when Resend refuses, without the subject or the recipients', async () => {
    const { mailer } = createMailer(
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

describe('createMailer without RESEND_API_KEY', () => {
  it('logs one line per mail with the link and keeps it in the outbox', async () => {
    const log = vi.fn()
    const { mailer, outbox } = createMailer({ RESEND_API_KEY: '' }, { log })

    await mailer.send({ ...mail, cc: ['c@acme.com'], replyTo: 'r@acme.com' })

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toBe(
      `RESEND_API_KEY is not set, so nothing is sent. From Arrakit <hello@example.com> to ana@acme.com, Cc c@acme.com, Reply-To r@acme.com: ${mail.subject}\n${mail.text}`,
    )
    expect(outbox?.list('ANA@acme.com')).toHaveLength(1)
    expect(outbox?.list('bo@acme.com')).toHaveLength(0)
  })

  it('lists the outbox newest first and clears it', async () => {
    const { mailer, outbox } = createMailer({}, { log: () => {} })
    await mailer.send({ ...mail, subject: 'first' })
    await mailer.send({ ...mail, subject: 'second' })
    expect(outbox!.list().map((m) => m.subject)).toEqual(['second', 'first'])
    outbox!.clear()
    expect(outbox!.list()).toEqual([])
  })

  it('refuses to start in production', () => {
    expect(() => createMailer({ NODE_ENV: 'production' })).toThrow(
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
