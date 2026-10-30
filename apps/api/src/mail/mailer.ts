import type { Mail, Mailer } from '@arrakit/emails'

import type { ApiEnv } from '../env'

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

export function createMailer(
  env: Pick<ApiEnv, 'NODE_ENV' | 'RESEND_API_KEY' | 'MAILPIT_URL' | 'MAIL_FROM'>,
  deps: { log: (line: string) => void; fetch?: typeof fetch },
): Mailer {
  const { MAIL_FROM: from } = env
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
            from,
            to: [mail.to].flat(),
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
            From: mailpitAddress(from),
            To: [mail.to].flat().map(mailpitAddress),
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

  return {
    async send(mail) {
      const to = [mail.to].flat()
      deps.log(
        `Neither RESEND_API_KEY nor MAILPIT_URL is set, so nothing is sent. From ${from} to ${to.join(', ')}: ${mail.subject}\n${mail.text}`,
      )
    },
  }
}

export function recordingMailer(): { mailer: Mailer; sent: Mail[] } {
  const sent: Mail[] = []
  return { sent, mailer: { send: async (mail) => void sent.push(mail) } }
}
