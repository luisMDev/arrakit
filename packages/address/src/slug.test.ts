import { describe, expect, it } from 'vitest'

import { MAX_SLUG_LENGTH, slugCandidates, slugOf } from './slug'

describe('slugOf', () => {
  it('lowercases, strips accents and joins words with -', () =>
    expect(slugOf('  Ácme Ventures, S.L. ')).toBe('acme-ventures-s-l'))

  it('is empty for a name with no letter or digit', () => expect(slugOf('北京')).toBe(''))

  it('fits MAX_SLUG_LENGTH', () => expect(slugOf('a'.repeat(100)).length).toBe(MAX_SLUG_LENGTH))
})

describe('slugCandidates', () => {
  it('starts with the slug, then numbers it', () =>
    expect(slugCandidates('Acme').slice(0, 3)).toEqual(['acme', 'acme-2', 'acme-3']))

  it('offers fifty candidates', () => expect(slugCandidates('Acme')).toHaveLength(50))

  it('is empty when there is no slug', () => expect(slugCandidates('!!')).toEqual([]))

  it('keeps each numbered slug within MAX_SLUG_LENGTH', () =>
    expect(slugCandidates('a'.repeat(100)).every((s) => s.length <= MAX_SLUG_LENGTH)).toBe(true))

  it('trims a trailing hyphen before the suffix', () => {
    const name = `${'a'.repeat(60)} b`
    expect(slugCandidates(name)[1]).toBe(`${'a'.repeat(60)}-2`)
  })
})
