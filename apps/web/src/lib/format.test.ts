import { afterEach, describe, expect, it } from 'vitest'

import { loadLanguage } from '#/i18n'

import { fullDay, listing, money, quantity } from './format'

afterEach(() => loadLanguage('en'))

describe('format', () => {
  it('writes whole amounts without cents, others with two', () => {
    expect(money({ amount: 143_000, currency: 'usd' })).toBe('$1,430')
    expect(money({ amount: 143_050, currency: 'usd' })).toBe('$1,430.50')
    expect(money({ amount: 11_950, currency: 'usd' }, { whole: true })).toBe('$120')
  })

  it('writes a calendar day without moving it', () => {
    expect(fullDay('2027-10-04')).toBe('Oct 4, 2027')
  })

  it('follows the active language', async () => {
    await loadLanguage('es')
    expect(fullDay('2027-10-04')).toBe('4 oct 2027')
    expect(quantity(2_000)).toBe('2000')
    expect(listing(['a', 'b'])).toBe('a y b')
  })
})
