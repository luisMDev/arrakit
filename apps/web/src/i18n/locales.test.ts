import { describe, expect, it } from 'vitest'

import { en, loadEs } from './resources'

const enFiles = import.meta.glob('./locales/en/*.json', { eager: true, import: 'default' })
const esFiles = import.meta.glob('./locales/es/*.json', { eager: true, import: 'default' })

function keys(tree: unknown, prefix = ''): string[] {
  if (tree === null || typeof tree !== 'object') return [prefix]
  return Object.entries(tree).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
}

const names = (files: Record<string, unknown>) => Object.keys(files).map((p) => p.split('/').at(-1))

describe('locales', () => {
  it('have one file per module in each language', () => {
    expect(names(esFiles)).toEqual(names(enFiles))
    expect(names(enFiles)).toEqual([
      'auth.json',
      'billing.json',
      'common.json',
      'members.json',
      'oauth.json',
      'onboarding.json',
      'organizations.json',
      'settings.json',
      'shell.json',
      'usage.json',
    ])
  })

  it.each(Object.keys(enFiles))('%s has the same keys in en and es', (path) => {
    const es = esFiles[path.replace('/en/', '/es/')]
    expect(keys(es).sort()).toEqual(keys(enFiles[path]).sort())
  })

  it('merge into one tree with no key defined twice', async () => {
    const total = Object.values(enFiles).reduce<number>((n, file) => n + keys(file).length, 0)
    expect(keys(en)).toHaveLength(total)
    expect(keys(await loadEs()).sort()).toEqual(keys(en).sort())
  })

  it('use the arrakit product name', () => {
    expect(JSON.stringify(enFiles)).not.toContain('SaaS')
    expect(JSON.stringify(esFiles)).not.toContain('SaaS')
  })
})
