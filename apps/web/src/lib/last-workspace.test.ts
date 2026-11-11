import { afterEach, describe, expect, it, vi } from 'vitest'

import { lastWorkspace, rememberWorkspace } from './last-workspace'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('last workspace', () => {
  it('remembers one workspace per organization', () => {
    rememberWorkspace('acme', 'deals')
    rememberWorkspace('birch', 'research')
    rememberWorkspace('acme', 'legal')
    expect(lastWorkspace('acme')).toBe('legal')
    expect(lastWorkspace('birch')).toBe('research')
    expect(lastWorkspace('cedar')).toBeNull()
  })

  it('does without storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => rememberWorkspace('acme', 'deals')).not.toThrow()
    expect(lastWorkspace('acme')).toBeNull()
  })
})
