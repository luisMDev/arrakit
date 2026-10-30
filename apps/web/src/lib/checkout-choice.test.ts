import { describe, expect, it } from 'vitest'

import { appLanding, checkoutChoice, profileLanding } from './checkout-choice'

describe('checkoutChoice', () => {
  it('keeps a paid plan with a known cycle', () => {
    expect(checkoutChoice({ plan: 'pro', cycle: 'yearly' })).toEqual({
      plan: 'pro',
      cycle: 'yearly',
    })
  })

  it.each([
    { plan: 'enterprise', cycle: 'monthly' },
    { plan: 'free', cycle: 'monthly' },
    { plan: 'internal', cycle: 'yearly' },
    { plan: 'pro', cycle: 'weekly' },
    { plan: 'Pro', cycle: 'monthly' },
    {},
  ])('drops %j', (search) => {
    expect(checkoutChoice(search)).toBeNull()
  })
})

describe('profileLanding', () => {
  it('lands on Profile, carrying a valid choice', () => {
    expect(profileLanding(null)).toBe('/profile')
    expect(profileLanding({ plan: 'team', cycle: 'monthly' })).toBe(
      '/profile?plan=team&cycle=monthly',
    )
  })
})

describe('appLanding', () => {
  it('lands on Checkout for a choice, else Home', () => {
    expect(appLanding(null)).toEqual({ to: '/app' })
    expect(appLanding({ plan: 'pro', cycle: 'yearly' })).toEqual({
      to: '/app/checkout',
      search: { plan: 'pro', cycle: 'yearly' },
    })
  })
})
