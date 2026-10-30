import { describe, expect, it } from 'vitest'

import { AUTHORIZE_PATH, authorizeResume } from './authorize-resume'

const resumeOf = (search: string) => {
  const resume = authorizeResume(search)
  if (!resume) throw new Error('no resume')
  const url = new URL(resume, 'http://localhost:4200')
  return { url, params: [...url.searchParams] }
}

describe('authorizeResume', () => {
  it('is null without a client', () => {
    expect(authorizeResume('')).toBeNull()
    expect(authorizeResume('?response_type=code&state=x')).toBeNull()
  })

  it('keeps the authorization parameters in order and drops the signature and the rest', () => {
    const { url, params } = resumeOf(
      '?response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s1&code_challenge=cc&code_challenge_method=S256&resource=http%3A%2F%2Flocalhost%3A4200%2Fapi%2Fmcp&exp=1&sig=xyz&ba_iat=2&ba_pl=3&ba_param=4&next=%2Fevil&via=google&error=boom',
    )
    expect(url.pathname).toBe(AUTHORIZE_PATH)
    expect(params).toEqual([
      ['response_type', 'code'],
      ['client_id', 'abc'],
      ['redirect_uri', 'https://claude.ai/cb'],
      ['state', 's1'],
      ['code_challenge', 'cc'],
      ['code_challenge_method', 'S256'],
      ['resource', 'http://localhost:4200/api/mcp'],
    ])
  })

  it('drops prompt=login and keeps the other prompts', () => {
    expect(resumeOf('?client_id=a&prompt=login').params).toEqual([['client_id', 'a']])
    expect(resumeOf('?client_id=a&prompt=login%20consent').params).toEqual([
      ['client_id', 'a'],
      ['prompt', 'consent'],
    ])
  })

  it('never leaves the authorize path, whatever the values say', () => {
    for (const search of [
      '?client_id=a&redirect_uri=https://evil.example',
      '?client_id=a&state=//evil.example/x',
      '?client_id=%2F%2Fevil.example&state=../../x',
    ]) {
      const { url } = resumeOf(search)
      expect(url.origin).toBe('http://localhost:4200')
      expect(url.pathname).toBe(AUTHORIZE_PATH)
    }
    expect(authorizeResume('?client_id=a&state=//evil.example/x')).toBe(
      `${AUTHORIZE_PATH}?client_id=a&state=%2F%2Fevil.example%2Fx`,
    )
  })
})
