import { describe, expect, it } from 'vitest'

import { deriveNames, rename, toSlug, validateNames } from './rename.ts'

const arrakit = deriveNames({ name: 'Arrakit' })
const acme = deriveNames({ name: 'Acme Cloud', scope: 'acme' })

const renamed = (text: string, from = arrakit, to = acme) => rename(text, from, to).text

describe('deriveNames', () => {
  it('derives slug, scope and identifier name from the product name', () => {
    expect(deriveNames({ name: '  Acme Cloud ' })).toEqual({
      name: 'Acme Cloud',
      slug: 'acme-cloud',
      scope: 'acme-cloud',
      pascal: 'AcmeCloud',
    })
  })

  it('keeps an explicit slug and scope, dropping a leading @', () => {
    expect(deriveNames({ name: 'Acme Cloud', slug: 'acme', scope: '@acme-labs' })).toEqual({
      name: 'Acme Cloud',
      slug: 'acme',
      scope: 'acme-labs',
      pascal: 'Acme',
    })
  })

  it('folds accents and symbols into a slug that starts with a letter', () => {
    expect(toSlug('Señal & Ruido')).toBe('senal-ruido')
    expect(toSlug('42 Café')).toBe('cafe')
  })
})

describe('validateNames', () => {
  it('accepts a derived identity', () => {
    expect(validateNames(acme)).toEqual([])
  })

  it.each([
    ['a name with quotes', { ...acme, name: `Acme "Cloud"` }, 'name'],
    ['a name with interpolation braces', { ...acme, name: 'Acme {{x}}' }, 'name'],
    ['an empty slug', { ...acme, slug: '' }, 'slug'],
    ['an uppercase slug', { ...acme, slug: 'Acme' }, 'slug'],
    ['a slug ending in a dash', { ...acme, slug: 'acme-' }, 'slug'],
    ['a scope starting with a digit', { ...acme, scope: '1acme' }, 'scope'],
  ])('refuses %s', (_, identity, field) => {
    const problems = validateNames(identity)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(new RegExp(`^${field} `))
  })
})

describe('rename', () => {
  it.each([
    ["import { db } from '@arrakit/db'", "import { db } from '@acme/db'"],
    ['"@arrakit/eslint-config": "workspace:*"', '"@acme/eslint-config": "workspace:*"'],
    ['alwaysBundle: [/^@arrakit\\//]', 'alwaysBundle: [/^@acme\\//]'],
    ["const INTERNALS_SPECIFIER = '^@arrakit.db.+$'", "const INTERNALS_SPECIFIER = '^@acme.db.+$'"],
    [
      "import { createArrakitOAuthClient } from '@arrakit/auth/client'",
      "import { createAcmeCloudOAuthClient } from '@acme/auth/client'",
    ],
    ["export const COOKIE_PREFIX = 'arrakit'", "export const COOKIE_PREFIX = 'acme-cloud'"],
    ["'arrakit.session_token=forged'", "'acme-cloud.session_token=forged'"],
    ["export const PRICE_KEY_PREFIX = 'arrakit_'", "export const PRICE_KEY_PREFIX = 'acme-cloud_'"],
    ["lookup_key: 'arrakit_pro_monthly'", "lookup_key: 'acme-cloud_pro_monthly'"],
    ["const STORED_THEME_KEY = 'arrakit.theme'", "const STORED_THEME_KEY = 'acme-cloud.theme'"],
    [
      "DATABASE_URL: 'postgres://localhost/arrakit'",
      "DATABASE_URL: 'postgres://localhost/acme-cloud'",
    ],
    ['"name": "arrakit",', '"name": "acme-cloud",'],
    ['ARRAKIT_FLAG=1', 'ACME_CLOUD_FLAG=1'],
    ["export const APP_NAME = 'Arrakit'", "export const APP_NAME = 'Acme Cloud'"],
    ['MAIL_FROM="Arrakit <hello@example.com>"', 'MAIL_FROM="Acme Cloud <hello@example.com>"'],
    ['{ name: "Couldn\'t reach Arrakit." }', '{ name: "Couldn\'t reach Acme Cloud." }'],
    ['# AGENTS.md — Arrakit', '# AGENTS.md — Acme Cloud'],
  ])('rewrites %s', (before, after) => {
    expect(renamed(before)).toBe(after)
  })

  it('counts every replacement', () => {
    expect(rename("'@arrakit/db' Arrakit arrakit_ createArrakit", arrakit, acme).count).toBe(4)
  })

  it('leaves words that only contain the name untouched', () => {
    const text = 'arrakits Arrakitty unarrakit @arrakitx'
    expect(rename(text, arrakit, acme)).toEqual({ text, count: 0 })
  })

  it('never renames a replacement again when the new name contains the old one', () => {
    const arrakitPro = deriveNames({ name: 'Arrakit Pro' })
    expect(renamed("'@arrakit/db' arrakit.theme Arrakit", arrakit, arrakitPro)).toBe(
      "'@arrakit-pro/db' arrakit-pro.theme Arrakit Pro",
    )
  })

  it('renames again from an identity that is no longer Arrakit', () => {
    const next = deriveNames({ name: 'Nimbus' })
    expect(
      renamed(
        "import { createAcmeCloudAuthClient } from '@acme/auth/client' // Acme Cloud, acme-cloud.lang",
        acme,
        next,
      ),
    ).toBe("import { createNimbusAuthClient } from '@nimbus/auth/client' // Nimbus, nimbus.lang")
  })
})
