import { describe, expect, it } from 'vitest'

import { contract } from './index'

describe('contract', () => {
  it('composes every module', () => {
    expect(Object.keys(contract)).toEqual([
      'authProviders',
      'me',
      'onboarding',
      'teams',
      'plans',
      'billing',
      'usage',
    ])
    expect(Object.keys(contract.onboarding)).toEqual(['create', 'skip'])
    expect(Object.keys(contract.billing)).toContain('topUp')
  })

  it('refuses a create without accepted terms', () => {
    const schema = contract.onboarding.create['~orpc'].inputSchema!
    const result = schema['~standard'].validate({ name: 'Acme', termsAccepted: 'true' })
    expect('issues' in (result as object)).toBe(true)
  })
})
