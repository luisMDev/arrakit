import { APP_NAME } from './brand'
import { escapeHtml } from './escape'
import type { RenderedEmail } from './mail'

interface Action {
  readonly label: string
  readonly href: string
}

type Block =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'note'; readonly text: string }
  | { readonly kind: 'actions'; readonly primary: Action; readonly secondary?: Action }
  | { readonly kind: 'rows'; readonly rows: readonly (readonly [label: string, value: string])[] }

interface EmailInput {
  readonly subject: string
  readonly heading: { readonly lead: string; readonly tail: string }
  readonly blocks: readonly Block[]
  readonly footer?: string
  readonly replyTo?: string
}

export const paragraph = (text: string): Block => ({ kind: 'paragraph', text })
export const note = (text: string): Block => ({ kind: 'note', text })
export const actions = (primary: Action, secondary?: Action): Block => ({
  kind: 'actions',
  primary,
  ...(secondary ? { secondary } : {}),
})
export const rows = (entries: readonly (readonly [label: string, value: string])[]): Block => ({
  kind: 'rows',
  rows: entries,
})

const SAFE_LINK = /^(https:\/\/|mailto:|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/)/i

function safeHref(url: string): string {
  if (!SAFE_LINK.test(url)) {
    throw new Error(`An email link must be https: or mailto:, got "${url}"`)
  }
  return escapeHtml(url)
}

const C = {
  ink: '#0a0a0a',
  muted: '#737373',
  line: '#e5e5e5',
  white: '#ffffff',
} as const
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"'
const P = `font-family:${SANS};font-size:16px;line-height:1.6;color:${C.ink};`

function buttonHtml(action: Action): string {
  return `<table ${TABLE}><tr><td align="center" bgcolor="${C.ink}" style="border-radius:6px;"><a href="${safeHref(action.href)}" style="display:inline-block;padding:12px 20px;font-family:${SANS};font-size:15px;font-weight:600;color:${C.white};text-decoration:none;">${escapeHtml(action.label)}</a></td></tr></table>`
}

function blockHtml(block: Block): string {
  switch (block.kind) {
    case 'paragraph':
      return `<p style="margin:0 0 20px;${P}">${escapeHtml(block.text)}</p>`
    case 'note':
      return `<p style="margin:0 0 20px;font-family:${SANS};font-size:14px;line-height:1.6;color:${C.muted};">${escapeHtml(block.text)}</p>`
    case 'actions': {
      const secondary = block.secondary
        ? `<td style="padding-left:20px;"><a href="${safeHref(block.secondary.href)}" style="font-family:${SANS};font-size:15px;color:${C.ink};">${escapeHtml(block.secondary.label)}</a></td>`
        : ''
      return `<table ${TABLE} style="margin:0 0 24px;"><tr><td>${buttonHtml(block.primary)}</td>${secondary}</tr></table>`
    }
    case 'rows': {
      const body = block.rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding:12px 0;border-top:1px solid ${C.line};"><table ${TABLE} width="100%"><tr><td style="font-family:${SANS};font-size:15px;color:${C.muted};">${escapeHtml(label)}</td><td align="right" style="font-family:${SANS};font-size:15px;color:${C.ink};">${escapeHtml(value)}</td></tr></table></td></tr>`,
        )
        .join('')
      return `<table ${TABLE} width="100%" style="margin:0 0 24px;border-collapse:collapse;">${body}</table>`
    }
  }
}

function renderHtml(input: EmailInput): string {
  const footer =
    input.footer === undefined
      ? ''
      : `<tr><td style="padding-top:20px;border-top:1px solid ${C.line};font-family:${SANS};font-size:13px;line-height:1.6;color:${C.muted};">${escapeHtml(input.footer)}</td></tr>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.white};">
<table ${TABLE} width="100%"><tr><td align="center" style="padding:40px 20px;">
<table ${TABLE} width="100%" style="max-width:480px;">
<tr><td style="padding-bottom:32px;font-family:${SANS};font-size:20px;font-weight:600;color:${C.ink};">${escapeHtml(APP_NAME)}</td></tr>
<tr><td>
<h1 style="margin:0 0 20px;font-family:${SANS};font-size:28px;line-height:1.2;font-weight:600;color:${C.ink};">${escapeHtml(input.heading.lead)} <span style="color:${C.muted};">${escapeHtml(input.heading.tail)}</span></h1>
${input.blocks.map(blockHtml).join('\n')}
</td></tr>
${footer}
</table>
</td></tr></table>
</body>
</html>
`
}

const actionText = (action: Action): string => `${action.label}: ${action.href}`

function blockText(block: Block): string {
  switch (block.kind) {
    case 'paragraph':
    case 'note':
      return block.text
    case 'actions':
      return [block.primary, ...(block.secondary ? [block.secondary] : [])]
        .map(actionText)
        .join('\n')
    case 'rows':
      return block.rows.map(([label, value]) => `${label}: ${value}`).join('\n')
  }
}

function renderText(input: EmailInput): string {
  const parts = [`${input.heading.lead} ${input.heading.tail}`, ...input.blocks.map(blockText)]
  if (input.footer !== undefined) parts.push(`--\n${input.footer}`)
  return `${parts.join('\n\n')}\n`
}

export function composeEmail(input: EmailInput): RenderedEmail {
  return {
    replyTo: input.replyTo ?? null,
    subject: input.subject,
    html: renderHtml(input),
    text: renderText(input),
  }
}
