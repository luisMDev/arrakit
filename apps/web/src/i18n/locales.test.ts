import { describe, expect, it } from 'vitest'

import en from './locales/en.json'
import es from './locales/es.json'

function keys(tree: unknown, prefix = ''): string[] {
  if (tree === null || typeof tree !== 'object') return [prefix]
  return Object.entries(tree).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
}

describe('locales', () => {
  it('en and es have the same keys', () => {
    expect(keys(es).sort()).toEqual(keys(en).sort())
  })

  it('use the arrakit product name', () => {
    expect(JSON.stringify(en)).not.toContain('SaaS')
    expect(JSON.stringify(es)).not.toContain('SaaS')
  })
})
