import { APP_NAME } from './brand'
import { escapeHtml } from './escape'
import type { RenderedEmail } from './mail'

export interface Action {
  label: string
  href: string
}

export type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'rows'; rows: [label: string, value: string][] }
  | { kind: 'actions'; primary: Action; secondary?: Action }

export interface EmailInput {
  subject: string
  heading: { lead: string; tail: string }
  blocks: Block[]
  footer?: string
  replyTo?: string
}

export function composeEmail(input: EmailInput): RenderedEmail {
  const text: string[] = [`${input.heading.lead} ${input.heading.tail}`]
  const html: string[] = [
    `<td>${escapeHtml(APP_NAME)}</td>`,
    `<h1>${escapeHtml(input.heading.lead)} <span>${escapeHtml(input.heading.tail)}</span></h1>`,
  ]
  for (const block of input.blocks) {
    if (block.kind === 'paragraph' || block.kind === 'note') {
      text.push(block.text)
      html.push(`<p>${escapeHtml(block.text)}</p>`)
    } else if (block.kind === 'rows') {
      text.push(block.rows.map(([label, value]) => `${label}: ${value}`).join('\n'))
      html.push(block.rows.map(([l, v]) => `<p>${escapeHtml(l)}: ${escapeHtml(v)}</p>`).join(''))
    } else {
      const actions = [block.primary, ...(block.secondary ? [block.secondary] : [])]
      text.push(actions.map((a) => `${a.label}: ${a.href}`).join('\n'))
      html.push(
        actions.map((a) => `<a href="${escapeHtml(a.href)}">${escapeHtml(a.label)}</a>`).join(' '),
      )
    }
  }
  if (input.footer) text.push(`--\n${input.footer}`)
  return {
    subject: input.subject,
    replyTo: input.replyTo ?? null,
    html: `<!doctype html><html lang="en"><body>${html.join('\n')}${
      input.footer ? `<hr><p>${escapeHtml(input.footer)}</p>` : ''
    }</body></html>`,
    text: `${text.join('\n\n')}\n`,
  }
}
