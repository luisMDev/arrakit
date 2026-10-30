import type { Mail, Mailer } from '@arrakit/emails'

export interface OutboxEntry extends Mail {
  from: string
  at: string
}

export interface Outbox {
  entries: OutboxEntry[]
  /** Newest first, optionally only mail to `to`. */
  list(to?: string): OutboxEntry[]
  clear(): void
}

export function createOutbox(): Outbox {
  const entries: OutboxEntry[] = []
  return {
    entries,
    list: (to) =>
      [...entries].reverse().filter(
        (mail) =>
          !to ||
          [mail.to]
            .flat()
            .map((a) => a.toLowerCase())
            .includes(to.toLowerCase()),
      ),
    clear: () => void entries.splice(0),
  }
}

interface MailerEnv {
  NODE_ENV?: string
  RESEND_API_KEY?: string
  MAIL_FROM?: string
}

export interface MailerDeps {
  fetch?: typeof fetch
  log?: (line: string) => void
}

const DEFAULT_FROM = 'Arrakit <hello@example.com>'

export function createMailer(
  env: MailerEnv,
  deps: MailerDeps = {},
): { mailer: Mailer; outbox?: Outbox } {
  const from = (mail: Mail) => mail.from ?? (env.MAIL_FROM || DEFAULT_FROM)
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === 'production') {
      throw new Error('[mail] missing env: RESEND_API_KEY (production never logs sign-in links)')
    }
    const outbox = createOutbox()
    const log = deps.log ?? ((line: string) => console.log(line))
    return {
      outbox,
      mailer: {
        async send(mail) {
          const to = [mail.to].flat()
          const cc = mail.cc?.length ? `, Cc ${mail.cc.join(', ')}` : ''
          const replyTo = mail.replyTo ? `, Reply-To ${mail.replyTo}` : ''
          log(
            `RESEND_API_KEY is not set, so nothing is sent. From ${from(mail)} to ${to.join(', ')}${cc}${replyTo}: ${mail.subject}\n${mail.text}`,
          )
          outbox.entries.push({ ...mail, from: from(mail), at: new Date().toISOString() })
          if (outbox.entries.length > 200) outbox.entries.shift()
        },
      },
    }
  }

  const doFetch = deps.fetch ?? fetch
  return {
    mailer: {
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
    },
  }
}

/** Test mailer: records every mail in `sent`. */
export function recordingMailer(): { mailer: Mailer; sent: Mail[] } {
  const sent: Mail[] = []
  return { sent, mailer: { send: async (mail) => void sent.push(mail) } }
}
