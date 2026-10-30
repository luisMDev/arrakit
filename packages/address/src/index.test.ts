import { describe, expect, it } from 'vitest'

import { normalizeEmail } from './index'

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Ana@Example.COM ')).toBe('ana@example.com')
  })
})
