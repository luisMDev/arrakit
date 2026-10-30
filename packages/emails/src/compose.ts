import { APP_NAME } from './brand'
import { escapeHtml } from './escape'
import type { RenderedEmail } from './mail'

export interface Link {
  readonly text: string
  readonly href: string
}

/** A run of text with links in it. */
export type Rich = readonly (string | Link)[]

export interface Action {
  readonly label: string
  readonly href: string
}

export interface Heading {
  readonly lead: string
  readonly tail: string
}

export interface Section {
  readonly label: string
  readonly text: string
  readonly open?: boolean
}

export interface EventCard {
  readonly tile: readonly [weekday: string, day: string]
  readonly title: string
  readonly when: string
  readonly guests: readonly string[]
  readonly missing: string
  readonly action: Action
}

export type Text = string | Rich

export type Block =
  | { readonly kind: 'paragraph'; readonly text: Text }
  | { readonly kind: 'note'; readonly text: Text }
  | { readonly kind: 'bullets'; readonly items: readonly string[] }
  | { readonly kind: 'actions'; readonly primary: Action; readonly secondary?: Action }
  | { readonly kind: 'choices'; readonly choices: readonly Action[] }
  | { readonly kind: 'rows'; readonly rows: readonly (readonly [label: string, value: string])[] }
  | { readonly kind: 'sections'; readonly sections: readonly Section[] }
  | { readonly kind: 'panel'; readonly text: Text }
  | { readonly kind: 'quote'; readonly text: string }
  | { readonly kind: 'event'; readonly event: EventCard }
  | { readonly kind: 'signature'; readonly name: string }

export interface EmailOrganization {
  readonly name: string
}

export interface EmailInput {
  readonly subject: string
  readonly heading: Heading
  readonly blocks: readonly Block[]
  readonly footer?: Text
  readonly organization?: EmailOrganization
  readonly replyTo?: string
}

export const link = (text: string, href: string): Link => ({ text, href })
export const paragraph = (text: Text): Block => ({ kind: 'paragraph', text })
export const note = (text: Text): Block => ({ kind: 'note', text })
export const bullets = (items: readonly string[]): Block => ({ kind: 'bullets', items })
export const actions = (primary: Action, secondary?: Action): Block => ({
  kind: 'actions',
  primary,
  ...(secondary ? { secondary } : {}),
})
export const choices = (options: readonly Action[]): Block => ({
  kind: 'choices',
  choices: options,
})
export const rows = (entries: readonly (readonly [label: string, value: string])[]): Block => ({
  kind: 'rows',
  rows: entries,
})
export const sections = (entries: readonly Section[]): Block => ({
  kind: 'sections',
  sections: entries,
})
export const panel = (text: Text): Block => ({ kind: 'panel', text })
export const quote = (text: string): Block => ({ kind: 'quote', text })
export const event = (card: EventCard): Block => ({ kind: 'event', event: card })
export const signature = (name: string): Block => ({ kind: 'signature', name })

const SAFE_LINK = /^(https:\/\/|mailto:|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/)/i

/** An escaped link target; anything but https:, mailto: or a local http: URL throws. */
export function safeHref(url: string): string {
  if (!SAFE_LINK.test(url)) {
    throw new Error(`An email link must be https: or mailto:, got "${url}"`)
  }
  return escapeHtml(url)
}

const toRich = (text: Text): Rich => (typeof text === 'string' ? [text] : text)

const C = {
  ink: '#0a0a0a',
  muted: '#737373',
  line: '#e5e5e5',
  surface: '#f5f5f5',
  white: '#ffffff',
} as const
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"'
const P = `font-family:${SANS};font-size:16px;line-height:1.6;color:${C.ink};`

function richHtml(text: Text): string {
  return toRich(text)
    .map((part) =>
      typeof part === 'string'
        ? escapeHtml(part)
        : `<a href="${safeHref(part.href)}" style="color:${C.ink};text-decoration:underline;">${escapeHtml(part.text)}</a>`,
    )
    .join('')
}

function buttonHtml(action: Action): string {
  return `<table ${TABLE}><tr><td align="center" bgcolor="${C.ink}" style="border-radius:6px;"><a href="${safeHref(action.href)}" style="display:inline-block;padding:12px 20px;font-family:${SANS};font-size:15px;font-weight:600;color:${C.white};text-decoration:none;">${escapeHtml(action.label)}</a></td></tr></table>`
}

function ruledHtml(cells: string[]): string {
  const body = cells
    .map(
      (cell) => `<tr><td style="padding:12px 0;border-top:1px solid ${C.line};">${cell}</td></tr>`,
    )
    .join('')
  return `<table ${TABLE} width="100%" style="margin:0 0 24px;border-collapse:collapse;">${body}</table>`
}

function blockHtml(block: Block): string {
  switch (block.kind) {
    case 'paragraph':
      return `<p style="margin:0 0 20px;${P}">${richHtml(block.text)}</p>`
    case 'note':
      return `<p style="margin:0 0 20px;font-family:${SANS};font-size:14px;line-height:1.6;color:${C.muted};">${richHtml(block.text)}</p>`
    case 'bullets': {
      const items = block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
      return `<ul style="margin:0 0 20px;padding-left:20px;${P}">${items}</ul>`
    }
    case 'actions': {
      const secondary = block.secondary
        ? `<td style="padding-left:20px;"><a href="${safeHref(block.secondary.href)}" style="font-family:${SANS};font-size:15px;color:${C.ink};">${escapeHtml(block.secondary.label)}</a></td>`
        : ''
      return `<table ${TABLE} style="margin:0 0 24px;"><tr><td>${buttonHtml(block.primary)}</td>${secondary}</tr></table>`
    }
    case 'choices': {
      const cells = block.choices
        .map(
          (choice) =>
            `<td align="center" style="padding:4px;"><a href="${safeHref(choice.href)}" style="display:block;padding:12px 8px;border:1px solid ${C.line};border-radius:6px;font-family:${SANS};font-size:15px;color:${C.ink};text-decoration:none;">${escapeHtml(choice.label)}</a></td>`,
        )
        .join('')
      return `<table ${TABLE} width="100%" style="margin:0 0 24px;"><tr>${cells}</tr></table>`
    }
    case 'rows':
      return ruledHtml(
        block.rows.map(
          ([label, value]) =>
            `<table ${TABLE} width="100%"><tr><td style="font-family:${SANS};font-size:15px;color:${C.muted};">${escapeHtml(label)}</td><td align="right" style="font-family:${SANS};font-size:15px;color:${C.ink};">${escapeHtml(value)}</td></tr></table>`,
        ),
      )
    case 'sections':
      return ruledHtml(
        block.sections.map(
          (section) =>
            `<div style="font-family:${SANS};font-size:12px;font-weight:600;letter-spacing:0.08em;color:${section.open ? C.ink : C.muted};">${escapeHtml(section.label.toUpperCase())}</div><div style="${P}">${escapeHtml(section.text)}</div>`,
        ),
      )
    case 'panel':
      return `<table ${TABLE} width="100%" style="margin:0 0 24px;"><tr><td bgcolor="${C.surface}" style="padding:16px 20px;border-radius:8px;${P}">${richHtml(block.text)}</td></tr></table>`
    case 'quote':
      return `<blockquote style="margin:0 0 24px;padding-left:16px;border-left:3px solid ${C.line};${P}">“${escapeHtml(block.text)}”</blockquote>`
    case 'event': {
      const { tile, title, when, guests, missing, action } = block.event
      const people = [...guests, missing].map(escapeHtml).join(' · ')
      return `<table ${TABLE} width="100%" style="margin:0 0 24px;"><tr><td style="padding:16px;border:1px solid ${C.line};border-radius:8px;"><div style="font-family:${SANS};font-size:12px;font-weight:600;color:${C.muted};">${escapeHtml(tile[0])} ${escapeHtml(tile[1])}</div><div style="${P}font-weight:600;">${escapeHtml(title)}</div><div style="font-family:${SANS};font-size:14px;color:${C.muted};">${escapeHtml(when)}</div><p style="font-family:${SANS};font-size:14px;color:${C.ink};">${people}</p>${buttonHtml(action)}</td></tr></table>`
    }
    case 'signature':
      return `<p style="margin:0;${P}">${escapeHtml(block.name)}</p>`
  }
}

function renderHtml(input: EmailInput): string {
  const footer =
    input.footer === undefined
      ? ''
      : `<tr><td style="padding-top:20px;border-top:1px solid ${C.line};font-family:${SANS};font-size:13px;line-height:1.6;color:${C.muted};">${richHtml(input.footer)}</td></tr>`
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

const richText = (text: Text): string =>
  toRich(text)
    .map((part) => (typeof part === 'string' ? part : `${part.text} (${part.href})`))
    .join('')

const actionText = (action: Action): string => `${action.label}: ${action.href}`

function blockText(block: Block): string {
  switch (block.kind) {
    case 'paragraph':
    case 'note':
    case 'panel':
      return richText(block.text)
    case 'bullets':
      return block.items.map((item) => `- ${item}`).join('\n')
    case 'actions':
      return [block.primary, ...(block.secondary ? [block.secondary] : [])]
        .map(actionText)
        .join('\n')
    case 'choices':
      return block.choices.map(actionText).join('\n')
    case 'rows':
      return block.rows.map(([label, value]) => `${label}: ${value}`).join('\n')
    case 'sections':
      return block.sections.map((s) => `${s.label.toUpperCase()}\n${s.text}`).join('\n\n')
    case 'quote':
      return `“${block.text}”`
    case 'event': {
      const { title, when, guests, missing, action } = block.event
      return [title, when, [...guests, missing].join(' · '), actionText(action)].join('\n')
    }
    case 'signature':
      return block.name
  }
}

function renderText(input: EmailInput): string {
  const parts = [`${input.heading.lead} ${input.heading.tail}`, ...input.blocks.map(blockText)]
  if (input.footer !== undefined) parts.push(`--\n${richText(input.footer)}`)
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
