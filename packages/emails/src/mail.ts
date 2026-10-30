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

/** A rendered email, ready to be addressed. */
export interface RenderedEmail {
  subject: string
  html: string
  text: string
  replyTo: string | null
}
