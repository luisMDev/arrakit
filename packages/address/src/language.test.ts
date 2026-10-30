import { describe, expect, it } from 'vitest'

import { isAccountLanguage } from './language'

describe('isAccountLanguage', () => {
  it.each([
    ['en', true],
    ['es', true],
    ['EN', false],
    ['fr', false],
    [undefined, false],
  ])('%j → %s', (value, expected) => {
    expect(isAccountLanguage(value)).toBe(expected)
  })
})
