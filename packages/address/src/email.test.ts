import { describe, expect, it } from 'vitest'

import { isWorkEmail, normalizeEmail } from './email'

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
