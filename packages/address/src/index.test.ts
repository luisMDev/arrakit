import { describe, expect, it } from 'vitest'

import {
  deviceName,
  domainOf,
  isAccountLanguage,
  isTimeZone,
  isWorkEmail,
  normalizeEmail,
  organizationNameOnSkip,
  organizationNameOr,
  personName,
  personNameRefusal,
  slugCandidates,
  slugOf,
} from './index'

describe('normalizeEmail', () => {
  it('trims and lowercases', () => expect(normalizeEmail('  Ana@Acme.COM ')).toBe('ana@acme.com'))
})

describe('isWorkEmail', () => {
  it.each([
    'ana@acme.com',
    ' Ana@Sub.Acme.io ',
    'first.last+ic@organization.co.uk',
    'ana@xn--mxail5aa.com',
    'ana@gmail.com',
  ])('accepts %j', (email) => expect(isWorkEmail(email)).toBe(true))

  it.each([
    '',
    'ana',
    'ana@',
    'ana@acme',
    'a b@acme.com',
    'ana@-acme.com',
    'lucia@cierzo',
    'a@b@c.com',
    'lucia gomez@cierzo.vc',
    'lucia@-cierzo.vc',
    'lucia@cierzo.vc.',
    '@cierzo.vc',
    'ana@mesalía.es',
  ])('refuses %j', (email) => expect(isWorkEmail(email)).toBe(false))

  it('keeps the local part as typed, accents included', () =>
    expect(isWorkEmail('iñigo@mesalia.es')).toBe(true))
})

describe('slugOf', () => {
  it('lowercases, strips accents and joins words with -', () =>
    expect(slugOf('  Ácme Ventures, S.L. ')).toBe('acme-ventures-s-l'))

  it('is empty for a name with no letter or digit', () => expect(slugOf('北京')).toBe(''))

  it('fits 63 characters', () => expect(slugOf('a'.repeat(100)).length).toBe(63))
})

describe('slugCandidates', () => {
  it('starts with the slug, then numbers it', () =>
    expect(slugCandidates('Acme').slice(0, 3)).toEqual(['acme', 'acme-2', 'acme-3']))

  it('offers fifty candidates', () => expect(slugCandidates('Acme')).toHaveLength(50))

  it('is empty when there is no slug', () => expect(slugCandidates('!!')).toEqual([]))

  it('keeps each numbered slug within 63 characters', () =>
    expect(slugCandidates('a'.repeat(100)).every((s) => s.length <= 63)).toBe(true))

  it('trims a trailing hyphen before the suffix', () => {
    const name = `${'a'.repeat(60)} b`
    expect(slugCandidates(name)[1]).toBe(`${'a'.repeat(60)}-2`)
  })
})

describe('domainOf', () => {
  it('takes the part after the last @, normalized, without trailing dots', () =>
    expect(domainOf(' A@B@Alder.VC. ')).toBe('alder.vc'))
})

describe('organizationNameOnSkip from a work domain', () => {
  it.each([
    ['ana@alder.vc', 'Alder'],
    ['x@mail.alder.co.uk', 'Alder'],
    ['x@alder-ventures.com', 'Alder Ventures'],
    ['x@team.rowan.com.au', 'Rowan'],
    ['x@info.co.uk', 'Info'],
    ['ana.perez@gmailventures.com', 'Gmailventures'],
  ])('%s → %j', (email, name) => expect(organizationNameOnSkip(email)).toBe(name))

  it('reads the local part when the domain has no label', () =>
    expect(organizationNameOnSkip('ana@co.uk')).toBe('Ana'))
})

describe('organizationNameOnSkip', () => {
  it('names the organization from a work domain, even with a person name', () =>
    expect(organizationNameOnSkip('sara@oak.vc', 'Sara Gil')).toBe('Oak'))

  it('names it after the person on free mail', () =>
    expect(organizationNameOnSkip('ana@gmail.com', 'Ana Ruiz')).toBe('Ana Ruiz'))

  it('names it after the person when the domain has no label', () =>
    expect(organizationNameOnSkip('x@co.uk', 'Ana Pérez')).toBe('Ana Pérez'))

  it("reads the person's name from the local part when they gave none", () =>
    expect(organizationNameOnSkip('ana.perez+x@gmail.com')).toBe('Ana Perez'))

  it('falls back to My Organization', () =>
    expect(organizationNameOnSkip('_@gmail.com')).toBe('My Organization'))
})

describe('organizationNameOr', () => {
  it('keeps a typed name', () => expect(organizationNameOr('Quill', 'ana@alder.vc')).toBe('Quill'))

  it.each([
    ['', 'dana@elm.vc', '', 'Elm'],
    ['   ', 'dana@oak-partners.com', '', 'Oak Partners'],
    ['&.!', 'dana@mail.yew.co.uk', '', 'Yew'],
    ['北京基金', 'dana@pine.vc', '', 'Pine'],
    ['', 'ana.perez@gmail.com', 'Ana Pérez', 'Ana Pérez'],
    ['', 'bruno.diaz@hotmail.com', '', 'Bruno Diaz'],
    ['&.!', 'dana@co.uk', 'Lucía Gómez', 'Lucía Gómez'],
  ])('%j for %s (person %j) → %j', (typed, email, person, name) =>
    expect(organizationNameOr(typed, email, person)).toBe(name),
  )
})

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

describe('deviceName', () => {
  it.each([
    [
      'Safari on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      'Mac',
    ],
    [
      'Chrome on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Mac',
    ],
    [
      'Safari on an iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'iPhone',
    ],
    [
      'Chrome on an iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
      'iPhone',
    ],
    [
      'Safari on an iPad',
      'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      'iPad',
    ],
    [
      'Chrome on Android',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
      'Android phone',
    ],
    [
      'Chrome on Windows 10',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Windows PC',
    ],
    [
      'Edge on Windows 10',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.68',
      'Windows PC',
    ],
    [
      'Firefox on Ubuntu',
      'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
      'Linux computer',
    ],
  ])('names %s', (_label, userAgent, name) => {
    expect(deviceName(userAgent)).toBe(name)
  })

  it.each([
    ['no user agent', null],
    ['an empty one', ''],
    ['supertest', 'node-superagent/3.8.3'],
    ['curl', 'curl/8.4.0'],
    ['a crawler with Mac in its name', 'Macintosh-Bot/1.0 (+http://example.com/crawler)'],
    [
      'a Chromebook',
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    ],
    ['Windows Update', 'Windows-Update-Agent/10.0.10011.16384 Client-Protocol/2.0'],
    ['iPhone only in a query string', 'SomeFetcher/2.1 (+https://example.com/?ref=iphone-app)'],
  ])('reads %s as a browser, guessing nothing', (_label, userAgent) => {
    expect(deviceName(userAgent)).toBe('browser')
  })
  it('reads an iPad in desktop mode as a Mac', () => {
    expect(
      deviceName(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      ),
    ).toBe('Mac')
  })
})

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

describe('personNameRefusal', () => {
  it.each([
    ['Ana Pérez', null],
    ['a'.repeat(100), null],
    ['', 'Enter your name.'],
    ['a'.repeat(101), 'Keep your name to 100 characters.'],
    ['Ana\nPérez', 'Keep your name on one line.'],
    ['Ana\u2028Pérez', 'Keep your name on one line.'],
  ])('%j → %j', (name, expected) => {
    expect(personNameRefusal(name)).toBe(expected)
  })
})
