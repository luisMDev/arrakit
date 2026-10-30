import { describe, expect, it } from 'vitest'
import { isTimeZone } from './time-zone'

describe('isTimeZone', () => {
  it.each(['Europe/Madrid', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'UTC'])(
    'accepts %j, a canonical IANA zone',
    (zone) => {
      expect(isTimeZone(zone)).toBe(true)
    },
  )
  it.each([
    ['Asia/Kolkata', 'Asia/Calcutta'],
    ['Europe/Kyiv', 'Europe/Kiev'],
  ])('accepts %j and %j, one zone under its two names', (renamed, older) => {
    expect(isTimeZone(renamed)).toBe(true)
    expect(isTimeZone(older)).toBe(true)
  })
  it.each([
    ['lower case', 'europe/madrid'],
    ['an offset', '+02:00'],
    ['an offset without a colon', '-0500'],
    ['GMT with an offset', 'GMT+1'],
    ['a city alone', 'Madrid'],
    ['an abbreviation', 'CET'],
    ['an empty string', ''],
    ['a leading space', ' Europe/Madrid'],
    ['a trailing line break', 'Europe/Madrid\n'],
    ['a path past the zone', 'Europe/Madrid/../../etc'],
    ['300 characters', 'A'.repeat(300)],
    ['another case of a listed zone', 'Antarctica/Dumontdurville'],
    ['another case of a renamed zone', 'America/Argentina/Buenos_aires'],
    ['a zone in upper case', 'EUROPE/MADRID'],
    ['a zone in no area', 'Nowhere/Madrid'],
  ])('refuses %s', (_label, value) => {
    expect(isTimeZone(value)).toBe(false)
  })
})
