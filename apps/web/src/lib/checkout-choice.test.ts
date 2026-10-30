import { describe, expect, it } from 'vitest'

import { checkoutChoice } from './checkout-choice'

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
