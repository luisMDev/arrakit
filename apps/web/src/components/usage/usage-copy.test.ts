import { afterEach, describe, expect, it } from 'vitest'

import { i18n, loadLanguage } from '#/i18n'

import { usageFixture } from './fixtures'
import {
  amountsLine,
  availableLine,
  resetLine,
  splitLine,
  topUpLine,
  usedLine,
  usedPercent,
} from './usage-copy'

describe('usage copy', () => {
  afterEach(() => i18n.changeLanguage('en'))

  it('writes the Pro fixture', () => {
    const [credits, storage] = usageFixture().metrics
    expect(availableLine(credits!)).toBe('750 credits left')
    expect(splitLine(credits!)).toBe('750 credits from your plan · 0 credits purchased')
    expect(usedLine(credits!)).toBe('250 credits used this month')
    expect(availableLine(storage!)).toBe('88 GB free')
    expect(usedLine(storage!)).toBe('12 GB of 100 GB used')
    expect(resetLine(credits!)).toBe("Your plan's part resets on Nov 4, 2026")
  })

  it('fills the bar by what was used of what there was', () => {
    const [credits, storage] = usageFixture({
      purchased: { credits: 2_000, storage_gb: 200 },
    }).metrics
    expect(availableLine(credits!)).toBe('2,750 credits left')
    expect(usedPercent(credits!)).toBe(8)
    expect(availableLine(storage!)).toBe('288 GB free')
    expect(usedLine(storage!)).toBe('12 GB of 300 GB used')
    expect(usedPercent(storage!)).toBe(4)
    expect(usedPercent({ ...credits!, used: 5, available: 0 })).toBe(100)
    expect(usedPercent({ ...credits!, used: 0, available: 0 })).toBe(0)
  })

  it('writes top-ups', () => {
    expect(
      topUpLine({
        cents: 2_500,
        amounts: [
          { metric: 'credits', amount: 2_500 },
          { metric: 'storage_gb', amount: 250 },
        ],
      }),
    ).toBe('$25 · 2,500 credits and 250 GB')
  })

  it('follows the active language', async () => {
    await loadLanguage('es')
    expect(
      amountsLine([
        { metric: 'credits', amount: 2_000 },
        { metric: 'storage_gb', amount: 200 },
      ]),
    ).toBe('2000 créditos y 200 GB')
  })
})
