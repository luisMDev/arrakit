import { describe, expect, it } from 'vitest'

import { signupSearch } from '#/components/auth/signup-page'
import { settingsSearch } from '#/components/settings/settings-sections'
import { unavailableSearch } from '#/components/shell/unavailable-page'
import { choiceSearch } from '#/lib/checkout-choice'
import { welcomeSearch } from '#/lib/guards'

describe('search params', () => {
  it.each([
    [
      { plan: 'team', cycle: 'monthly', other: 'x' },
      { plan: 'team', cycle: 'monthly' },
    ],
    [
      { plan: 'bogus', cycle: 7 },
      { plan: 'bogus', cycle: '7' },
    ],
    [{ plan: null, cycle: { x: 1 } }, {}],
  ])('reads the plan and cycle of %j as text', (search, expected) =>
    expect(choiceSearch.parse(search)).toEqual(expected),
  )

  it.each([
    [
      { section: 'billing', top_up: 'done' },
      { section: 'billing', top_up: 'done' },
    ],
    [{ section: 'toString', top_up: 1 }, { top_up: '1' }],
    [{ section: 'nope' }, {}],
  ])('keeps a known settings section of %j', (search, expected) =>
    expect(settingsSearch.parse(search)).toEqual(expected),
  )

  it('keeps session ids and next targets as text only', () => {
    expect(welcomeSearch.parse({ session_id: 'cs_1' })).toEqual({ session_id: 'cs_1' })
    expect(welcomeSearch.parse({ session_id: 1 })).toEqual({ session_id: '1' })
    expect(welcomeSearch.parse({ session_id: null })).toEqual({})
    expect(unavailableSearch.parse({ next: '/app' })).toEqual({ next: '/app' })
    expect(unavailableSearch.parse({ next: { to: '/app' } })).toEqual({})
  })

  it('reads a signup search as a choice plus a refusal', () => {
    expect(signupSearch.parse({ plan: 'pro', cycle: 'yearly', error: 404, via: 'google' })).toEqual(
      { plan: 'pro', cycle: 'yearly', error: '404', via: 'google' },
    )
    expect(signupSearch.parse({ error: null, via: true })).toEqual({})
  })
})
