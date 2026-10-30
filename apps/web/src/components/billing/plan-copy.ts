import type { BillingView, ChangePreview, PaidChoice, PlanOfferView } from '@arrakit/contract'
import type { BillingCycle, Plan } from '@arrakit/plans'

import { i18n, tr } from '#/i18n'

export interface Money {
  amount: number
  currency: string
}

type Lang = 'en' | 'es'

const LOCALES: Record<Lang, string> = { en: 'en-US', es: 'es-ES' }
const activeLang = (): Lang => (i18n.language === 'es' ? 'es' : 'en')

const MONTHS: Record<Lang, readonly string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'],
}

export function fullDay(day: string, lang: Lang = activeLang()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) throw new Error(`"${day}" is not a calendar day (YYYY-MM-DD)`)
  const [year, month, date] = match.slice(1).map(Number) as [number, number, number]
  const name = MONTHS[lang][month - 1]
  return lang === 'es' ? `${date} ${name} ${year}` : `${name} ${date}, ${year}`
}

export function money({ amount, currency }: Money, { whole = false } = {}): string {
  const digits = whole || amount % 100 === 0 ? 0 : 2
  return new Intl.NumberFormat(LOCALES[activeLang()], {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount / 100)
}

export const planLabel = (plan: Plan): string => tr(`pricing.plan.${plan}`)

const features = (keys: readonly string[]) => keys.map((key) => tr(`pricing.feature.${key}`))

const PLAN_FEATURES: Record<Plan, string[]> = {
  free: ['coreFeatures'],
  pro: ['everythingInFree', 'prioritySupport'],
  team: ['everythingInPro', 'teamFeatures'],
  internal: ['everythingInTeam'],
}

export const planFeatures = (plan: Plan): string[] => features(PLAN_FEATURES[plan])

const PRICING_FEATURES: Record<Plan, { lead: string | null; features: string[] }> = {
  free: { lead: null, features: ['coreFeatures'] },
  pro: { lead: 'everythingInFreePlus', features: ['prioritySupport'] },
  team: { lead: 'everythingInProPlus', features: ['teamFeatures'] },
  internal: { lead: 'everythingInTeam', features: [] },
}

export function pricingCopy({ plan, seats }: Pick<PlanOfferView, 'plan' | 'seats'>) {
  const { lead, features: keys } = PRICING_FEATURES[plan]
  return {
    usage: [seatsLine(seats)],
    lead: lead && tr(`pricing.feature.${lead}`),
    features: features(keys),
  }
}

export function seatsLine(seats: number, upTo = tr('pricing.upTo')): string {
  return seats === 1 ? tr('pricing.oneSeat') : tr('pricing.seatsUpTo', { upTo, seats })
}

export interface PlanPrice {
  was: string | null
  price: string
  billed: string | null
  billedNote: string | null
}

export function planPrice(offer: PlanOfferView, cycle: BillingCycle): PlanPrice {
  if (offer.monthly.amount === 0) {
    return {
      was: null,
      price: money(offer.monthly, { whole: true }),
      billed: null,
      billedNote: null,
    }
  }
  if (cycle === 'monthly') {
    return {
      was: null,
      price: money(offer.monthly, { whole: true }),
      billed: tr('pricing.billedLower.monthly'),
      billedNote: tr('pricing.billed.monthly'),
    }
  }
  return {
    was: money(offer.monthly, { whole: true }),
    price: money(
      { ...offer.yearly, amount: Math.round(offer.yearly.amount / 12) },
      { whole: true },
    ),
    billed: tr('pricing.billedLower.yearly'),
    billedNote: tr('pricing.billedYearlyTotal', { total: money(offer.yearly) }),
  }
}

export const yearlySaving = ({ monthly, yearly }: PlanOfferView): number =>
  Math.round((1 - yearly.amount / (monthly.amount * 12)) * 100)

export function leastYearlySaving(offers: PlanOfferView[]): number | null {
  const savings = offers.filter((o) => o.monthly.amount > 0).map(yearlySaving)
  return savings.length > 0 ? Math.min(...savings) : null
}

export const twelveMonths = ({ monthly }: PlanOfferView): Money => ({
  ...monthly,
  amount: monthly.amount * 12,
})

export function switchLines(from: Plan, to: PaidChoice, preview: ChangePreview): string[] {
  const label = planLabel(to.plan)
  const after = tr(`plans.per.${to.cycle}`, { amount: money(preview.nextInvoice) })
  if (preview.applies === 'now') {
    return [
      tr('plans.dueToday', { amount: money(preview.dueToday) }),
      tr('plans.movesNow', { plan: label }),
      tr('plans.then', { after }),
    ]
  }
  const on = fullDay(preview.on)
  return [
    tr('plans.nothingToday'),
    from === to.plan
      ? tr(`plans.staysOn.${to.cycle}`, { plan: label, on, after })
      : tr('plans.keepsUntil', { from: planLabel(from), on, plan: label, after }),
  ]
}

export function planLine({ plan, cycle }: { plan: Plan; cycle: BillingCycle | null }): string {
  return cycle
    ? tr('settings.billingSettings.planCycle', {
        plan: planLabel(plan),
        cycle: tr(`settings.billingSettings.cycle.${cycle}`),
      })
    : planLabel(plan)
}

export function scheduledLine({ scheduledChange }: BillingView): string | null {
  return scheduledChange
    ? tr('settings.billingSettings.scheduled', {
        plan: planLine(scheduledChange),
        day: fullDay(scheduledChange.on),
      })
    : null
}

export function cancelLine({ plan, renewsOn }: BillingView): string {
  return renewsOn
    ? tr('settings.billingSettings.cancelUntil', { plan: planLabel(plan), day: fullDay(renewsOn) })
    : tr('settings.billingSettings.cancelNoDate', { plan: planLabel(plan) })
}

const CARD_BRANDS: Record<string, string> = {
  amex: 'American Express',
  diners: 'Diners Club',
  mastercard: 'Mastercard',
  unionpay: 'UnionPay',
}

export function cardLine({ card }: Pick<BillingView, 'card'>): string {
  if (!card) return tr('settings.billingSettings.noCard')
  const brand = CARD_BRANDS[card.brand] ?? card.brand.charAt(0).toUpperCase() + card.brand.slice(1)
  return tr('settings.billingSettings.cardEnding', { brand, last4: card.last4 })
}

export const invoiceLine = (invoice: BillingView['invoices'][number]): string =>
  `${money(invoice.total)} · ${tr(`settings.billingSettings.invoiceStatus.${invoice.status}`)}`
