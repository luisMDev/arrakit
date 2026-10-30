import { describe, expect, it } from 'vitest'

import { personName } from './person-name'

describe('personName', () => {
  it.each([
    ['  Ana Ruiz ', 'ana@acme.com', 'Ana Ruiz'],
    ['', 'ana@acme.com', 'ana'],
    ['   ', 'ana@acme.com', 'ana'],
    [null, 'ana@acme.com', 'ana'],
    [undefined, 'ana@acme.com', 'ana'],
    ['', '@acme.com', '@acme.com'],
  ])('%j with %j → %j', (name, email, expected) => {
    expect(personName(name, email)).toBe(expected)
  })
})
