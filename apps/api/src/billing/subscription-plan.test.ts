import { describe, expect, it } from 'vitest'

import {
  billedPlanOf,
  planOfSubscription,
  priceLookupKey,
  subscriptionOfLookupKey,
  whenChangeApplies,
} from './subscription-plan'

describe('priceLookupKey', () => {
  it('names a price by plan and cycle', () => {
    expect(priceLookupKey('pro', 'yearly')).toBe('arrakit_pro_yearly')
    expect(priceLookupKey('team', 'monthly')).toBe('arrakit_team_monthly')
  })
})

describe('planOfSubscription', () => {
  it.each(['active', 'trialing', 'past_due'])('keeps the paid plan while %s', (status) => {
    expect(planOfSubscription(status, 'pro_yearly')).toBe('pro')
    expect(planOfSubscription(status, 'team_monthly')).toBe('team')
  })

  it.each(['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'])(
    'puts the organization back on Free once %s',
    (status) => expect(planOfSubscription(status, 'pro_yearly')).toBe('free'),
  )

  it('reads Free from a price whose lookup key names no plan', () => {
    expect(planOfSubscription('active', null)).toBe('free')
    expect(planOfSubscription('active', 'enterprise_yearly')).toBe('free')
    expect(planOfSubscription('active', 'internal_monthly')).toBe('free')
  })

  it('reads the plan from a lookup key that names it first, whatever follows', () => {
    expect(planOfSubscription('active', 'pro_monthly_eur')).toBe('pro')
    expect(planOfSubscription('active', 'pro_weekly')).toBe('pro')
    expect(planOfSubscription('active', 'team')).toBe('team')
  })
})

describe('billedPlanOf', () => {
  it('reads the plan a lookup key names first, and the cycle when the next part is one', () => {
    expect(billedPlanOf('pro_yearly')).toEqual({ plan: 'pro', cycle: 'yearly' })
    expect(billedPlanOf('team_monthly_eur')).toEqual({ plan: 'team', cycle: 'monthly' })
    expect(billedPlanOf('pro_weekly')).toEqual({ plan: 'pro', cycle: null })
    expect(billedPlanOf('team')).toEqual({ plan: 'team', cycle: null })
  })

  it.each([null, '', 'enterprise_yearly', 'internal_monthly', 'free_yearly'])(
    'reads no paid plan from %s',
    (key) => expect(billedPlanOf(key)).toBeNull(),
  )
})

describe('subscriptionOfLookupKey', () => {
  it('reads the paid plan and cycle a price bills', () => {
    expect(subscriptionOfLookupKey('pro_yearly')).toEqual({ plan: 'pro', cycle: 'yearly' })
    expect(subscriptionOfLookupKey('team_monthly')).toEqual({ plan: 'team', cycle: 'monthly' })
    expect(subscriptionOfLookupKey('pro_monthly_eur')).toEqual({ plan: 'pro', cycle: 'monthly' })
  })

  it.each([null, 'enterprise_yearly', 'pro_weekly', 'pro'])('reads nothing from %s', (key) => {
    expect(subscriptionOfLookupKey(key)).toBeNull()
  })

  it('agrees with planOfSubscription on the plan of every key it reads', () => {
    for (const key of ['pro_yearly', 'team_monthly', 'pro_monthly_eur']) {
      expect(subscriptionOfLookupKey(key)?.plan).toBe(planOfSubscription('active', key))
    }
  })
})

describe('whenChangeApplies', () => {
  it('moves an organization up a plan now, whatever the cycle', () => {
    expect(
      whenChangeApplies({ plan: 'pro', cycle: 'monthly' }, { plan: 'team', cycle: 'monthly' }),
    ).toBe('now')
    expect(
      whenChangeApplies({ plan: 'pro', cycle: 'yearly' }, { plan: 'team', cycle: 'monthly' }),
    ).toBe('now')
  })

  it('moves an organization down a plan, or to another cycle, at its renewal', () => {
    expect(
      whenChangeApplies({ plan: 'team', cycle: 'yearly' }, { plan: 'pro', cycle: 'yearly' }),
    ).toBe('renewal')
    expect(
      whenChangeApplies({ plan: 'pro', cycle: 'monthly' }, { plan: 'pro', cycle: 'yearly' }),
    ).toBe('renewal')
    expect(
      whenChangeApplies({ plan: 'pro', cycle: 'yearly' }, { plan: 'pro', cycle: 'monthly' }),
    ).toBe('renewal')
  })

  it('moves a plan billed on an unknown cycle to a known cycle of the same plan at its renewal', () => {
    expect(whenChangeApplies({ plan: 'pro', cycle: null }, { plan: 'pro', cycle: 'yearly' })).toBe(
      'renewal',
    )
    expect(whenChangeApplies({ plan: 'pro', cycle: null }, { plan: 'team', cycle: 'yearly' })).toBe(
      'now',
    )
  })

  it('changes nothing for the plan and cycle the organization already pays for', () => {
    expect(
      whenChangeApplies({ plan: 'team', cycle: 'yearly' }, { plan: 'team', cycle: 'yearly' }),
    ).toBeNull()
  })
})
