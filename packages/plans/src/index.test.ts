import { describe, expect, it } from 'vitest'

import { BILLING_CYCLES, METRIC_KEYS, PLANS, PLAN_OFFERS, isPlan } from './index'

describe('plans package', () => {
  it('exposes the billing cycles', () => {
    expect(BILLING_CYCLES).toEqual(['monthly', 'yearly'])
  })

  it('ranks plans and has one offer per plan', () => {
    expect(PLANS).toEqual(['free', 'pro', 'team', 'internal'])
    expect(Object.keys(PLAN_OFFERS)).toEqual([...PLANS])
    expect(METRIC_KEYS).toEqual(['credits', 'storage_gb'])
  })

  it('matches plans exactly', () => {
    expect(isPlan('pro')).toBe(true)
    expect(isPlan('Pro')).toBe(false)
    expect(isPlan('internal ')).toBe(false)
  })
})
