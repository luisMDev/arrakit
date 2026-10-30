import { describe, expect, it } from 'vitest'

import { toFileKey, toFolderPrefix } from './file-key'

const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e'

describe('toFileKey', () => {
  it.each([
    'report.pdf',
    'companies/c1/report.v2..final.pdf',
    '..hidden',
    'trailing..',
    '...',
    'ñandú/informe 2026.pdf',
    'file%2e%2e.pdf',
  ])('accepts %j under the organization prefix', (name) => {
    expect(toFileKey(ORG, name)).toBe(`${ORG}/${name}`)
  })

  it('lowercases the organization id', () => {
    expect(toFileKey(ORG.toUpperCase(), 'a.pdf')).toBe(`${ORG}/a.pdf`)
  })

  it.each([
    '',
    '.',
    '..',
    '../x',
    'a/../b',
    'a/./b',
    '/abs',
    'a//b',
    'a/',
    'a\\b',
    'a\u0000b',
    'line\nbreak',
    'del\u007f',
    'x'.repeat(1024),
  ])('refuses %j', (name) => {
    expect(() => toFileKey(ORG, name)).toThrow(
      `[data] not a usable file name: ${JSON.stringify(name)}`,
    )
  })

  it('refuses a non-UUID organization', () => {
    expect(() => toFileKey('acme', 'a.pdf')).toThrow('[data] not an organization id')
  })
})

describe('toFolderPrefix', () => {
  it('reads "" as the whole organization', () => {
    expect(toFolderPrefix(ORG, '')).toBe(`${ORG}/`)
  })

  it('accepts a slash-terminated folder', () => {
    expect(toFolderPrefix(ORG, 'companies/c1/')).toBe(`${ORG}/companies/c1/`)
  })

  it.each([
    'companies/c1',
    '/',
    '//',
    '/companies/',
    'companies//',
    '../',
    'companies/../',
    './',
    'a\\b/',
    'a\u0000/',
    'a\n/',
    `${'x'.repeat(1024)}/`,
  ])('refuses %j', (folder) => {
    expect(() => toFolderPrefix(ORG, folder)).toThrow(
      `[data] not a usable folder: ${JSON.stringify(folder)}`,
    )
  })
})
