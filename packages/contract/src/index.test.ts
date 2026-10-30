import { describe, expect, it } from 'vitest'

import { contract } from './index'

describe('contract', () => {
  it('composes every module', () => {
    expect(Object.keys(contract)).toEqual([
      'authProviders',
      'me',
      'organizations',
      'members',
      'invitations',
      'plans',
      'billing',
      'usage',
    ])
    expect(Object.keys(contract.organizations)).toEqual(['create', 'skip', 'update', 'delete'])
    expect(Object.keys(contract.billing)).toContain('topUp')
  })

  it('refuses a create without accepted terms', () => {
    const schema = contract.organizations.create['~orpc'].inputSchema!
    const result = schema['~standard'].validate({ name: 'Acme', termsAccepted: 'true' })
    expect('issues' in (result as object)).toBe(true)
  })
})
