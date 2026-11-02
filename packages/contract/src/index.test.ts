import { describe, expect, it } from 'vitest'

import { contract } from './index'

describe('contract', () => {
  it('composes every module', () => {
    expect(Object.keys(contract)).toEqual([
      'authProviders',
      'me',
      'teams',
      'plans',
      'billing',
      'usage',
    ])
    expect(Object.keys(contract.me)).toEqual(['get', 'account'])
    expect(Object.keys(contract.billing)).toContain('topUp')
  })
})
