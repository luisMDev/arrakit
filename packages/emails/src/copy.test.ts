import { describe, expect, it } from 'vitest'

import { count, daysUntil, firstName, fullDay, shortDay } from './copy'

describe('calendar days', () => {
  it('writes a YYYY-MM-DD day as that day, wherever the server runs', () => {
    expect(shortDay('2027-10-04')).toBe('Oct 4')
    expect(fullDay('2027-10-04')).toBe('Oct 4, 2027')
    expect(fullDay('2026-01-01')).toBe('Jan 1, 2026')
  })

  it('refuses something that is not a calendar day', () => {
    expect(() => shortDay('2026-10-09T10:00:00Z')).toThrow(/YYYY-MM-DD/)
    expect(() => shortDay('INV-2026-0042')).toThrow(/YYYY-MM-DD/)
  })
})

describe('daysUntil', () => {
  const now = new Date('2026-01-01T00:00:00Z')
  it.each([
    [0, 1],
    [1, 1],
    [-3_600_000, 1],
    [86_400_000 + 1, 2],
    [3 * 86_400_000, 3],
  ])('%sms ahead → %s days', (ms, days) =>
    expect(daysUntil(new Date(now.getTime() + ms), now)).toBe(days),
  )
})

describe('counts', () => {
  it('says one thing in the singular and any other number in the plural', () => {
    expect(count(1, 'file')).toBe('1 file')
    expect(count(42, 'file')).toBe('42 files')
    expect(count(0, 'file')).toBe('0 files')
    expect(count(1, 'company', 'companies')).toBe('1 company')
    expect(count(3, 'company', 'companies')).toBe('3 companies')
  })

  it('names first names', () => {
    expect(firstName('  Ana Pérez Soler ')).toBe('Ana')
  })
})
