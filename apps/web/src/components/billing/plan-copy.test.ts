import { afterEach, describe, expect, it } from 'vitest'

import { loadLanguage } from '#/i18n'

import { plansAbove } from './plan-access'
import {
  cardLine,
  leastYearlySaving,
  planLine,
  planPrice,
  seatsLine,
  switchLines,
  yearlySaving,
} from './plan-copy'
import { OFFERS } from './testing'

const [free, pro, team] = OFFERS as [(typeof OFFERS)[0], (typeof OFFERS)[0], (typeof OFFERS)[0]]

afterEach(() => loadLanguage('en'))

describe('planPrice', () => {
  it('shows Free at $0 with nothing billed', () => {
    expect(planPrice(free, 'yearly')).toEqual({
      was: null,
      price: '$0',
      billed: null,
      billedNote: null,
    })
  })

  it('shows Pro monthly at $20', () => {
    expect(planPrice(pro, 'monthly')).toEqual({
      was: null,
      price: '$20',
      billed: 'billed monthly',
      billedNote: 'Billed monthly',
    })
  })

  it('shows Pro yearly at $16 a month, struck from $20', () => {
    expect(planPrice(pro, 'yearly')).toEqual({
      was: '$20',
      price: '$16',
      billed: 'billed yearly',
      billedNote: '$192 billed yearly',
    })
  })

  it('saves 20% yearly on every paid plan', () => {
    expect(yearlySaving(pro)).toBe(20)
    expect(yearlySaving(team)).toBe(20)
    expect(leastYearlySaving(OFFERS)).toBe(20)
    expect(leastYearlySaving([free])).toBeNull()
  })
})

describe('lines', () => {
  it('writes seats', () => {
    expect(seatsLine(1)).toBe('1 seat')
    expect(seatsLine(3)).toBe('Up to 3 seats')
  })

  it('writes the plan with its cycle', () => {
    expect(planLine({ plan: 'pro', cycle: 'yearly' })).toBe('Pro · yearly')
    expect(planLine({ plan: 'free', cycle: null })).toBe('Free')
  })

  it.each([
    ['visa', 'Visa ending 4242'],
    ['amex', 'American Express ending 4242'],
    ['diners', 'Diners Club ending 4242'],
    ['mastercard', 'Mastercard ending 4242'],
    ['unionpay', 'UnionPay ending 4242'],
  ])('names the %s card', (brand, line) => {
    expect(cardLine({ card: { brand, last4: '4242' } })).toBe(line)
  })

  it('says when there is no card', () => {
    expect(cardLine({ card: null })).toBe('No card yet')
  })

  it('explains a switch charged now', () => {
    expect(
      switchLines(
        'pro',
        { plan: 'team', cycle: 'yearly' },
        {
          applies: 'now',
          on: '2026-10-30',
          dueToday: { amount: 120_000, currency: 'usd' },
          nextInvoice: { amount: 48_000, currency: 'usd' },
        },
      ),
    ).toEqual([
      '$1,200 today, for the rest of this period.',
      'Your organization moves to Team now.',
      'Then $480 a year.',
    ])
  })

  it('explains a switch at the renewal', () => {
    const preview = {
      applies: 'renewal' as const,
      on: '2027-10-04',
      dueToday: { amount: 0, currency: 'usd' },
      nextInvoice: { amount: 2_000, currency: 'usd' },
    }
    expect(switchLines('team', { plan: 'pro', cycle: 'monthly' }, preview)).toEqual([
      'Nothing to pay today.',
      'Your organization keeps Team until Oct 4, 2027, then moves to Pro: $20 a month.',
    ])
    expect(switchLines('pro', { plan: 'pro', cycle: 'monthly' }, preview)[1]).toBe(
      'Your organization stays on Pro, billed monthly from Oct 4, 2027: $20 a month.',
    )
  })
})

describe('plansAbove', () => {
  it.each([
    ['free', ['pro', 'team']],
    ['pro', ['team']],
    ['team', []],
    ['internal', []],
  ] as const)('offers %s the plans above it', (plan, above) => {
    expect(plansAbove(plan)).toEqual(above)
  })
})
