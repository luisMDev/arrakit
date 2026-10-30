import { describe, expect, it } from 'vitest'

import { contract } from './index'

describe('contract', () => {
  it('declares the ping procedure', () => {
    expect(contract.ping['~orpc'].route.path).toBe('/ping')
  })
})
