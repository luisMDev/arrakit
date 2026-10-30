import { describe, expect, it } from 'vitest'

import {
  isMetric,
  isTopUpAmount,
  metricAmount,
  metricAmounts,
  metricBalance,
  metricOf,
  planGrant,
  splitConsumption,
  usagePeriod,
} from './usage'

const at = (iso: string) => new Date(iso)

describe('metric amounts', () => {
  it('converts cents into every metric, rounding down', () => {
    expect(metricAmounts(2_000)).toEqual({ credits: 2_000, storage_gb: 200 })
    expect(metricAmount('storage_gb', 1_005)).toBe(100)
    expect(metricAmount('credits', 1_005)).toBe(1_005)
  })

  it('grants each plan its monthly part', () => {
    expect(planGrant('free')).toEqual({ credits: 100, storage_gb: 10 })
    expect(planGrant('pro')).toEqual({ credits: 1_000, storage_gb: 100 })
    expect(planGrant('team')).toEqual({ credits: 3_000, storage_gb: 300 })
    expect(planGrant('internal')).toEqual({ credits: 10_000, storage_gb: 1_000 })
  })

  it('knows metrics exactly', () => {
    expect(isMetric('credits')).toBe(true)
    expect(isMetric('storage_gb')).toBe(true)
    for (const bad of ['Credits', 'gb', '', null, undefined, 3]) expect(isMetric(bad)).toBe(false)
    expect(() => metricOf('nope' as never)).toThrow('no metric nope')
  })
})

describe('isTopUpAmount', () => {
  it('accepts whole cents from $10 to $500', () => {
    expect(isTopUpAmount(1_000)).toBe(true)
    expect(isTopUpAmount(50_000)).toBe(true)
    expect(isTopUpAmount(2_000)).toBe(true)
  })

  it('refuses anything else', () => {
    for (const bad of [999, 50_001, 1_000.5, '2000', null, undefined, Number.NaN]) {
      expect(isTopUpAmount(bad)).toBe(false)
    }
  })
})

describe('usagePeriod', () => {
  it.each([
    [
      '2026-01-15T10:00:00Z',
      '2026-03-20T00:00:00Z',
      '2026-03-15T10:00:00Z',
      '2026-04-15T10:00:00Z',
    ],
    [
      '2026-01-15T10:00:00Z',
      '2026-03-15T09:59:59Z',
      '2026-02-15T10:00:00Z',
      '2026-03-15T10:00:00Z',
    ],
    [
      '2026-01-31T00:00:00Z',
      '2026-02-28T12:00:00Z',
      '2026-02-28T00:00:00Z',
      '2026-03-31T00:00:00Z',
    ],
  ])('anchor %s, now %s -> %s .. %s', (anchor, now, start, end) => {
    expect(usagePeriod(at(anchor), at(now))).toEqual({ start: at(start), end: at(end) })
  })

  it('counts across years', () => {
    expect(usagePeriod(at('2025-11-05T00:00:00Z'), at('2026-01-06T00:00:00Z')).start).toEqual(
      at('2026-01-05T00:00:00Z'),
    )
  })

  it('starts at the anchor when now is before it', () => {
    expect(usagePeriod(at('2026-05-01T00:00:00Z'), at('2026-04-01T00:00:00Z')).start).toEqual(
      at('2026-05-01T00:00:00Z'),
    )
  })

  it('returns to the 31st in long months', () => {
    expect(usagePeriod(at('2026-01-31T00:00:00Z'), at('2026-03-31T01:00:00Z')).start).toEqual(
      at('2026-03-31T00:00:00Z'),
    )
  })
})

describe('splitConsumption', () => {
  it('spends the plan first, then purchased', () => {
    expect(splitConsumption(30, { plan: 50, purchased: 100 })).toEqual({ plan: 30, purchased: 0 })
    expect(splitConsumption(80, { plan: 50, purchased: 100 })).toEqual({ plan: 50, purchased: 30 })
  })

  it('refuses what the balance does not cover', () => {
    expect(splitConsumption(151, { plan: 50, purchased: 100 })).toBeNull()
    expect(splitConsumption(1, { plan: 0, purchased: -50 })).toBeNull()
  })
})

describe('metricBalance', () => {
  it('computes a consumable balance', () => {
    expect(
      metricBalance('credits', { granted: 100, planUsed: 100, purchased: 950, used: 150 }),
    ).toEqual({
      metric: 'credits',
      kind: 'consumable',
      granted: 100,
      plan: 0,
      purchased: 950,
      used: 150,
      available: 950,
      limit: null,
    })
  })

  it('shows a refund debt as 0 purchased', () => {
    const balance = metricBalance('credits', { granted: 100, purchased: -50 })
    expect(balance.purchased).toBe(0)
    expect(balance.available).toBe(100)
  })

  it('computes a capacity balance from the level', () => {
    expect(metricBalance('storage_gb', { granted: 10, purchased: 200 }, 12)).toEqual({
      metric: 'storage_gb',
      kind: 'capacity',
      granted: 10,
      plan: 10,
      purchased: 200,
      used: 12,
      available: 198,
      limit: 210,
    })
  })

  it('lets a negative purchased lower a capacity limit', () => {
    expect(metricBalance('storage_gb', { granted: 10, purchased: -5 }).limit).toBe(5)
  })
})
