import { i18n } from '#/i18n'

export interface Money {
  amount: number
  currency: string
}

const locale = () => (i18n.language === 'es' ? 'es-ES' : 'en-US')

/** "$25", "$25.50": cents shown only when there are some, never with `whole`. */
export function money({ amount, currency }: Money, { whole = false } = {}): string {
  const digits = whole || amount % 100 === 0 ? 0 : 2
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount / 100)
}

export const quantity = (n: number): string => new Intl.NumberFormat(locale()).format(n)

/** "Nov 4, 2026", "4 nov 2026" for a `YYYY-MM-DD` day. */
export function fullDay(day: string): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  )
}

export const listing = (items: readonly string[]): string =>
  new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' }).format(items)
