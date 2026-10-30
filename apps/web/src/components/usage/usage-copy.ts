import type { UsageView } from '@arrakit/contract'
import { CURRENCY, type Metric } from '@arrakit/plans'

import { i18n, tr } from '#/i18n'

export type MetricUsage = UsageView['metrics'][number]
export type TopUpRecord = UsageView['topUps'][number]
type MetricAmount = TopUpRecord['amounts'][number]

const KEY = 'settings.usageSettings'
const LOCALES: Record<string, string> = { en: 'en-US', es: 'es-ES' }

const locale = () => LOCALES[i18n.language] ?? 'en-US'

/** "2,000", "2.000" */
export function quantity(n: number): string {
  return new Intl.NumberFormat(locale()).format(n)
}

/** "$25", "$25.50": cents shown only when there are some. */
export function money(cents: number, currency: string = CURRENCY): string {
  const digits = cents % 100 === 0 ? 0 : 2
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100)
}

/** "Nov 4, 2026", "4 nov 2026" for a `YYYY-MM-DD` day. */
export function fullDay(day: string): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  )
}

function listing(items: readonly string[]): string {
  return new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' }).format(items)
}

export function metricLabel(metric: Metric | string): string {
  return tr(`${KEY}.metric.${metric}`)
}

/** "2,000 credits", "200 GB" */
export function amountText(metric: Metric | string, amount: number): string {
  return tr(`${KEY}.amount.${metric}`, { n: quantity(amount) })
}

/** "1,750 credits left", "38 GB free" */
export function availableLine({ metric, kind, available }: MetricUsage): string {
  return tr(`${KEY}.available.${kind}`, { amount: amountText(metric, available) })
}

/** "750 credits from your plan · 1,000 credits purchased" */
export function splitLine({ metric, plan, purchased }: MetricUsage): string {
  return tr(`${KEY}.split`, {
    plan: amountText(metric, plan),
    purchased: amountText(metric, purchased),
  })
}

/** "250 credits used this month", "12 GB of 50 GB used" */
export function usedLine({ metric, kind, used, limit }: MetricUsage): string {
  return kind === 'capacity'
    ? tr(`${KEY}.usedOf`, {
        used: amountText(metric, used),
        limit: amountText(metric, limit ?? 0),
      })
    : tr(`${KEY}.usedThisMonth`, { amount: amountText(metric, used) })
}

/** How full the bar is, 0 to 100. */
export function usedPercent({ kind, used, available, limit }: MetricUsage): number {
  const whole = kind === 'capacity' ? (limit ?? 0) : used + available
  return whole <= 0 ? (used > 0 ? 100 : 0) : Math.min(100, Math.round((used / whole) * 100))
}

/** "Your plan's part resets on Nov 4, 2026" */
export function resetLine({ resetsOn }: MetricUsage): string {
  return tr(`${KEY}.resets`, { day: fullDay(resetsOn) })
}

/** "2,000 credits and 200 GB" */
export function amountsLine(amounts: readonly MetricAmount[]): string {
  return listing(amounts.map(({ metric, amount }) => amountText(metric, amount)))
}

/** "$25 · 2,500 credits and 250 GB" */
export function topUpLine({ cents, amounts }: Pick<TopUpRecord, 'cents' | 'amounts'>): string {
  return `${money(cents)} · ${amountsLine(amounts)}`
}
