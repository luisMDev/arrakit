import { APP_NAME, type Mail, type Mailer } from '@arrakit/emails'

interface MailerEnv {
  NODE_ENV?: string
  RESEND_API_KEY?: string
  MAILPIT_URL?: string
  MAIL_FROM?: string
}

export interface MailerDeps {
  fetch?: typeof fetch
  log?: (line: string) => void
}

const DEFAULT_FROM = `${APP_NAME} <hello@example.com>`

interface MailpitAddress {
  Email: string
  Name?: string
}

export function mailpitAddress(address: string): MailpitAddress {
  const named = address.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (!named) return { Email: address.trim() }
  const name = named[1]!.replace(/^"(.*)"$/, '$1')
  return name ? { Email: named[2]!, Name: name } : { Email: named[2]! }
}

export function createMailer(env: MailerEnv, deps: MailerDeps = {}): Mailer {
  const from = (mail: Mail) => mail.from ?? (env.MAIL_FROM || DEFAULT_FROM)
  const doFetch = deps.fetch ?? fetch

  if (env.RESEND_API_KEY) {
    return {
      async send(mail) {
        const res = await doFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env.RESEND_API_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: from(mail),
            ...(mail.replyTo ? { reply_to: [mail.replyTo] } : {}),
            to: [mail.to].flat(),
            ...(mail.cc?.length ? { cc: mail.cc } : {}),
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
          }),
        })
        // Never include the subject or the recipients in the error.
        if (!res.ok)
          throw new Error(`[mail] Resend refused the email: ${res.status} ${await res.text()}`)
      },
    }
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('[mail] missing env: RESEND_API_KEY (production never logs sign-in links)')
  }

  if (env.MAILPIT_URL) {
    const endpoint = new URL('/api/v1/send', env.MAILPIT_URL).href
    return {
      async send(mail) {
        const res = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            From: mailpitAddress(from(mail)),
            To: [mail.to].flat().map(mailpitAddress),
            ...(mail.cc?.length ? { Cc: mail.cc.map(mailpitAddress) } : {}),
            ...(mail.replyTo ? { ReplyTo: [mailpitAddress(mail.replyTo)] } : {}),
            Subject: mail.subject,
            HTML: mail.html,
            Text: mail.text,
          }),
        }).catch((error: unknown) => {
          throw new Error(`[mail] Mailpit is not reachable at ${env.MAILPIT_URL}`, { cause: error })
        })
        if (!res.ok)
          throw new Error(`[mail] Mailpit refused the email: ${res.status} ${await res.text()}`)
      },
    }
  }

  const log = deps.log ?? ((line: string) => console.log(line))
  return {
    async send(mail) {
      const to = [mail.to].flat()
      const cc = mail.cc?.length ? `, Cc ${mail.cc.join(', ')}` : ''
      const replyTo = mail.replyTo ? `, Reply-To ${mail.replyTo}` : ''
      log(
        `Neither RESEND_API_KEY nor MAILPIT_URL is set, so nothing is sent. From ${from(mail)} to ${to.join(', ')}${cc}${replyTo}: ${mail.subject}\n${mail.text}`,
      )
    },
  }
}

export function recordingMailer(): { mailer: Mailer; sent: Mail[] } {
  const sent: Mail[] = []
  return { sent, mailer: { send: async (mail) => void sent.push(mail) } }
}
