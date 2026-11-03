import { describe, expect, it } from 'vitest'

import {
  FILE_NAME_MAX,
  FILE_POLICIES,
  PLANS,
  contentTypeOf,
  fileExtension,
  filePolicyFor,
  fileRefusal,
  storageGbFor,
} from './index'

const policy = filePolicyFor('free')

describe('file policy', () => {
  it('has a policy for every plan', () => {
    expect(Object.keys(FILE_POLICIES).sort()).toEqual([...PLANS].sort())
  })

  it('reads the extension in lowercase and ignores leading dots', () => {
    expect(fileExtension('Report.Final.PDF')).toBe('pdf')
    expect(fileExtension('.env')).toBeUndefined()
    expect(fileExtension('README')).toBeUndefined()
    expect(fileExtension('trailing.')).toBeUndefined()
  })

  it('accepts an allowed file up to the size limit', () => {
    expect(fileRefusal({ name: 'a.pdf', sizeBytes: 0 }, policy)).toBeUndefined()
    expect(fileRefusal({ name: 'a.pdf', sizeBytes: policy.maxBytes }, policy)).toBeUndefined()
  })

  it('refuses a file over the size limit', () => {
    expect(fileRefusal({ name: 'a.pdf', sizeBytes: policy.maxBytes + 1 }, policy)).toBe('size')
    expect(fileRefusal({ name: 'a.pdf', sizeBytes: -1 }, policy)).toBe('size')
    expect(fileRefusal({ name: 'a.pdf', sizeBytes: 1.5 }, policy)).toBe('size')
  })

  it('refuses extensions the policy does not list, including markup served as a page', () => {
    for (const name of ['a.exe', 'a.svg', 'a.html', 'noextension', 'a.toString']) {
      expect(fileRefusal({ name, sizeBytes: 1 }, policy)).toBe('type')
    }
  })

  it('refuses unusable names', () => {
    for (const name of ['', ' a.pdf', 'a.pdf ', 'dir/a.pdf', 'a\\b.pdf', 'a\u0000.pdf']) {
      expect(fileRefusal({ name, sizeBytes: 1 }, policy)).toBe('name')
    }
    const long = `${'x'.repeat(FILE_NAME_MAX - 3)}.pdf`
    expect(fileRefusal({ name: long, sizeBytes: 1 }, policy)).toBe('name')
  })

  it('stores a file as the content type of its extension', () => {
    expect(contentTypeOf('notes.MD', policy)).toBe('text/markdown')
    expect(contentTypeOf('photo.jpeg', policy)).toBe('image/jpeg')
    expect(contentTypeOf('a.exe', policy)).toBeUndefined()
  })

  it('rounds stored bytes up to whole gigabytes', () => {
    expect(storageGbFor(0)).toBe(0)
    expect(storageGbFor(1)).toBe(1)
    expect(storageGbFor(1_000_000_000)).toBe(1)
    expect(storageGbFor(1_000_000_001)).toBe(2)
  })
})
