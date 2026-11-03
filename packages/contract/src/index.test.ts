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
      'workspaces',
      'files',
    ])
    expect(Object.keys(contract.workspaces)).toEqual(['list', 'get', 'create', 'update', 'delete'])
    expect(Object.keys(contract.files)).toEqual([
      'list',
      'requestUpload',
      'completeUpload',
      'downloadUrl',
      'rename',
      'delete',
    ])
    expect(Object.keys(contract.me)).toEqual(['get', 'account'])
    expect(Object.keys(contract.billing)).toContain('topUp')
  })
})
