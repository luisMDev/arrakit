import { describe, expect, it } from 'vitest'

import { PAID_PLANS, PLANS, PLAN_LABELS, PLAN_OFFERS, isPlan } from './catalog'

describe('plans catalog', () => {
  it('ranks the sold plans cheapest first, Internal last above Team', () => {
    const sold = PLANS.filter((plan) => plan !== 'internal')
    const prices = sold.map((plan) => PLAN_OFFERS[plan].monthlyCents)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    expect(PLANS.at(-1)).toBe('internal')
    expect(PLANS.indexOf('internal')).toBeGreaterThan(PLANS.indexOf('team'))
  })

  it('labels Internal', () => {
    expect(PLAN_LABELS.internal).toBe('Internal')
  })

  it('sells only Pro and Team', () => {
    expect(PAID_PLANS).toEqual(['pro', 'team'])
  })

  it('makes yearly 20% cheaper than twelve months on every paid plan', () => {
    for (const plan of PAID_PLANS) {
      const { monthlyCents, yearlyCents } = PLAN_OFFERS[plan]
      expect(yearlyCents).toBe(monthlyCents * 12 * 0.8)
    }
  })

  it('gives more seats with each rank', () => {
    const seats = PLANS.map((plan) => PLAN_OFFERS[plan].seats)
    expect(seats).toEqual([1, 3, 10, 100])
  })

  it.each(['free', 'pro', 'team', 'internal'])('accepts %s', (plan) => {
    expect(isPlan(plan)).toBe(true)
  })

  it.each(['enterprise', 'Pro', 'Internal', 'internal ', '', null, undefined, 1])(
    'refuses %o',
    (value) => {
      expect(isPlan(value)).toBe(false)
    },
  )
})
