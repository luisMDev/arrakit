import type { UsageView } from '@arrakit/contract'
import { CURRENCY, type Metric } from '@arrakit/plans'

import { i18n } from '#/i18n'
import { fullDay, listing, money, quantity } from '#/lib/format'

export type MetricUsage = UsageView['metrics'][number]
type TopUpRecord = UsageView['topUps'][number]
type MetricAmount = TopUpRecord['amounts'][number]

const KEY = 'settings.usageSettings'
export function metricLabel(metric: Metric | string): string {
  return i18n.t(`${KEY}.metric.${metric}`)
}

function amountText(metric: Metric | string, amount: number): string {
  return i18n.t(`${KEY}.amount.${metric}`, { n: quantity(amount) })
}

/** "1,750 credits left", "38 GB free" */
export function availableLine({ metric, kind, available }: MetricUsage): string {
  return i18n.t(`${KEY}.available.${kind}`, { amount: amountText(metric, available) })
}

/** "750 credits from your plan · 1,000 credits purchased" */
export function splitLine({ metric, plan, purchased }: MetricUsage): string {
  return i18n.t(`${KEY}.split`, {
    plan: amountText(metric, plan),
    purchased: amountText(metric, purchased),
  })
}

/** "250 credits used this month", "12 GB of 50 GB used" */
export function usedLine({ metric, kind, used, limit }: MetricUsage): string {
  return kind === 'capacity'
    ? i18n.t(`${KEY}.usedOf`, {
        used: amountText(metric, used),
        limit: amountText(metric, limit ?? 0),
      })
    : i18n.t(`${KEY}.usedThisMonth`, { amount: amountText(metric, used) })
}

/** How full the bar is, 0 to 100. */
export function usedPercent({ kind, used, available, limit }: MetricUsage): number {
  const whole = kind === 'capacity' ? (limit ?? 0) : used + available
  return whole <= 0 ? (used > 0 ? 100 : 0) : Math.min(100, Math.round((used / whole) * 100))
}

/** "Your plan's part resets on Nov 4, 2026" */
export function resetLine({ resetsOn }: MetricUsage): string {
  return i18n.t(`${KEY}.resets`, { day: fullDay(resetsOn) })
}

/** "2,000 credits and 200 GB" */
export function amountsLine(amounts: readonly MetricAmount[]): string {
  return listing(amounts.map(({ metric, amount }) => amountText(metric, amount)))
}

/** "$25 · 2,500 credits and 250 GB" */
export function topUpLine({ cents, amounts }: Pick<TopUpRecord, 'cents' | 'amounts'>): string {
  return `${money({ amount: cents, currency: CURRENCY })} · ${amountsLine(amounts)}`
}
