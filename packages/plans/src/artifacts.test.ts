import { describe, expect, it } from 'vitest'

import {
  ARTIFACT_POLICIES,
  PLANS,
  artifactFormatOf,
  artifactPolicyFor,
  contentBytes,
  fitsArtifact,
  isArtifactFormat,
} from './index'

describe('artifact policy', () => {
  it('has a policy for every plan', () => {
    expect(Object.keys(ARTIFACT_POLICIES).sort()).toEqual([...PLANS].sort())
  })

  it('counts content in UTF-8 bytes, not characters', () => {
    expect(contentBytes('abc')).toBe(3)
    expect(contentBytes('año')).toBe(4)
    expect(contentBytes('')).toBe(0)
  })

  it('accepts content up to the limit and refuses one byte more', () => {
    const policy = artifactPolicyFor('free')
    expect(fitsArtifact('x'.repeat(policy.maxBytes), policy)).toBe(true)
    expect(fitsArtifact('x'.repeat(policy.maxBytes + 1), policy)).toBe(false)
    expect(fitsArtifact('ñ'.repeat(policy.maxBytes / 2 + 1), policy)).toBe(false)
  })

  it('reads the format from a file name', () => {
    expect(artifactFormatOf('report.HTML')).toBe('html')
    expect(artifactFormatOf('report.htm')).toBe('html')
    expect(artifactFormatOf('notes.md')).toBe('markdown')
    expect(artifactFormatOf('notes.markdown')).toBe('markdown')
    for (const name of ['deck.pdf', 'README', 'a.toString', '.md']) {
      expect(artifactFormatOf(name)).toBeUndefined()
    }
  })

  it('knows the formats exactly', () => {
    expect(isArtifactFormat('html')).toBe(true)
    expect(isArtifactFormat('markdown')).toBe(true)
    for (const bad of ['HTML', 'md', '', null, undefined]) expect(isArtifactFormat(bad)).toBe(false)
  })
})
