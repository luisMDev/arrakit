import { describe, expect, it } from 'vitest'

import {
  domainOf,
  isFreeMail,
  nameFromLocalPart,
  organizationNameFromEmail,
  organizationNameOnSkip,
  organizationNameOr,
} from './organization-name'

describe('domainOf', () => {
  it('takes the part after the last @, normalized, without trailing dots', () =>
    expect(domainOf(' A@B@Alder.VC. ')).toBe('alder.vc'))
})

describe('organizationNameFromEmail', () => {
  it.each([
    ['ana@alder.vc', 'Alder'],
    ['x@mail.alder.co.uk', 'Alder'],
    ['x@alder-ventures.com', 'Alder Ventures'],
    ['x@co.uk', ''],
    ['x@team.rowan.com.au', 'Rowan'],
    ['x@info.co.uk', 'Info'],
  ])('%s → %j', (email, name) => expect(organizationNameFromEmail(email)).toBe(name))
})

describe('nameFromLocalPart', () => {
  it('drops the +tag and title-cases the words', () =>
    expect(nameFromLocalPart('ana.perez+x@gmail.com')).toBe('Ana Perez'))
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

describe('isFreeMail', () => {
  it('matches the whole domain only', () => {
    expect(isFreeMail('a@gmail.com')).toBe(true)
    expect(isFreeMail('a@gmailventures.com')).toBe(false)
    expect(isFreeMail('a@acme.com')).toBe(false)
  })
})
