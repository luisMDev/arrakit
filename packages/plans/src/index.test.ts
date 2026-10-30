import { describe, expect, it } from 'vitest'

import { BILLING_CYCLES } from './index'

describe('plans package', () => {
  it('exposes the billing cycles', () => {
    expect(BILLING_CYCLES).toEqual(['monthly', 'yearly'])
  })
})
