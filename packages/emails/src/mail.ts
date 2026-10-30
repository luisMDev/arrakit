export interface Mail {
  to: string | string[]
  subject: string
  html: string
  text: string
}

export interface Mailer {
  send(mail: Mail): Promise<void>
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export const toMail = ({ subject, html, text }: RenderedEmail, to: string): Mail => ({
  to,
  subject,
  html,
  text,
})
