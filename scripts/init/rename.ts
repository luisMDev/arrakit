export interface Identity {
  name: string
  slug: string
  scope: string
  pascal: string
}

export interface NameInput {
  name: string
  slug?: string
  scope?: string
}

const SLUG = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u

export function toSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+|-+$/g, '')
}

export function toPascal(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('')
}

export function deriveNames({ name, slug, scope }: NameInput): Identity {
  const trimmed = name.trim()
  const finalSlug = slug?.trim() || toSlug(trimmed)
  return {
    name: trimmed,
    slug: finalSlug,
    scope: scope?.trim().replace(/^@/, '') || finalSlug,
    pascal: toPascal(finalSlug),
  }
}

/** Returns one message per invalid field; empty when the identity is usable. */
export function validateNames(identity: Identity): string[] {
  const problems: string[] = []
  if (!NAME.test(identity.name)) {
    problems.push(
      `name "${identity.name}" may only hold letters, digits, spaces, ".", "-" and "_", starting with a letter or digit`,
    )
  }
  if (!SLUG.test(identity.slug)) {
    problems.push(
      `slug "${identity.slug}" must be lowercase letters, digits and "-", starting with a letter`,
    )
  }
  if (!SLUG.test(identity.scope)) {
    problems.push(
      `scope "${identity.scope}" must be lowercase letters, digits and "-", starting with a letter`,
    )
  }
  return problems
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

type Kind = 'scope' | 'identifier' | 'brand' | 'constant' | 'slug'

/**
 * One regex with an alternative per kind, tried in this order at each position and applied in a
 * single pass, so a replacement is never matched again by a later kind.
 */
export function renamePattern(from: Identity): RegExp {
  const ident = '[A-Za-z0-9_$]'
  const alternatives: Record<Kind, string> = {
    scope: `@${escape(from.scope)}(?![a-z0-9-])`,
    identifier: `(?<=${ident})${escape(from.pascal)}|${escape(from.pascal)}(?=[A-Z0-9_$])`,
    brand: `(?<!${ident})${escape(from.name)}(?!${ident})`,
    constant: `(?<![A-Za-z0-9])${escape(from.slug.toUpperCase().replace(/-/g, '_'))}(?![A-Za-z0-9])`,
    slug: `(?<![A-Za-z0-9])${escape(from.slug)}(?![A-Za-z0-9])`,
  }
  const source = (Object.keys(alternatives) as Kind[])
    .map((kind) => `(?<${kind}>${alternatives[kind]})`)
    .join('|')
  return new RegExp(source, 'g')
}

function replacementFor(groups: Partial<Record<Kind, string>>, to: Identity): string {
  if (groups.scope) return `@${to.scope}`
  if (groups.identifier) return to.pascal
  if (groups.brand) return to.name
  if (groups.constant) return to.slug.toUpperCase().replace(/-/g, '_')
  return to.slug
}

export function rename(
  text: string,
  from: Identity,
  to: Identity,
): { text: string; count: number } {
  let count = 0
  const result = text.replace(renamePattern(from), (...args) => {
    count++
    const groups = args[args.length - 1] as Partial<Record<Kind, string>>
    return replacementFor(groups, to)
  })
  return { text: result, count }
}
