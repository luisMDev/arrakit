export interface Mail {
  to: string | string[]
  cc?: string[]
  subject: string
  html: string
  text: string
  from?: string
  replyTo?: string
}

export interface Mailer {
  send(mail: Mail): Promise<void>
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
  replyTo: string | null
}

export const toMail = ({ subject, html, text, replyTo }: RenderedEmail, to: string): Mail => ({
  to,
  subject,
  html,
  text,
  ...(replyTo ? { replyTo } : {}),
})
