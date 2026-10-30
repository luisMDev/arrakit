import { pathToFileURL } from 'node:url'

import { APP_NAME } from '@arrakit/emails'
import { CURRENCY, PAID_PLANS, PLAN_LABELS, PLAN_OFFERS, TOP_UP } from '@arrakit/plans'
import Stripe from 'stripe'

import { TOP_UP_LOOKUP_KEY } from '../src/billing/real-stripe'
import { priceLookupKey } from '../src/billing/subscription-plan'

type CreditsStripe = Pick<Stripe, 'products' | 'prices'>

export const CREDITS_AMOUNT = {
  minimum: TOP_UP.minCents,
  maximum: TOP_UP.maxCents,
  preset: Math.min(TOP_UP.minCents * 2, TOP_UP.maxCents),
}

/** Does an existing price already sell top-ups as the catalog says? */
export function priceMatches(
  price: Pick<Stripe.Price, 'active' | 'currency' | 'custom_unit_amount'>,
): boolean {
  const custom = price.custom_unit_amount
  return (
    price.active &&
    price.currency === CURRENCY &&
    custom?.minimum === CREDITS_AMOUNT.minimum &&
    custom?.maximum === CREDITS_AMOUNT.maximum
  )
}

/** Idempotently ensures the Credits product and its pay-what-you-want top-up price. */
export async function ensureCreditsPrice(
  stripe: CreditsStripe,
): Promise<{ productId: string; priceId: string; created: boolean }> {
  const found = await stripe.products.search({ query: "metadata['kind']:'credits'" })
  const product =
    found.data[0] ??
    (await stripe.products.create({
      name: `${APP_NAME} Credits`,
      metadata: { kind: 'credits' },
    }))

  const [existing] = (
    await stripe.prices.list({ lookup_keys: [TOP_UP_LOOKUP_KEY], active: true, limit: 1 })
  ).data
  if (existing && existing.product === product.id && priceMatches(existing)) {
    return { productId: product.id, priceId: existing.id, created: false }
  }

  const price = await stripe.prices.create({
    product: product.id,
    currency: CURRENCY,
    lookup_key: TOP_UP_LOOKUP_KEY,
    transfer_lookup_key: true,
    custom_unit_amount: { enabled: true, ...CREDITS_AMOUNT },
  })
  if (existing) await stripe.prices.update(existing.id, { active: false })
  return { productId: product.id, priceId: price.id, created: true }
}

const CYCLES = [
  { cycle: 'monthly', interval: 'month', cents: 'monthlyCents' },
  { cycle: 'yearly', interval: 'year', cents: 'yearlyCents' },
] as const

export async function syncPrices(stripe: Stripe, log: (line: string) => void = console.log) {
  const mode = (await stripe.balance.retrieve()).livemode ? 'LIVE' : 'test'

  for (const plan of PAID_PLANS) {
    const offer = PLAN_OFFERS[plan]
    const found = await stripe.products.search({ query: `metadata['plan']:'${plan}'` })
    const product =
      found.data[0] ??
      (await stripe.products.create({
        name: `${APP_NAME} ${PLAN_LABELS[plan]}`,
        metadata: { plan },
      }))
    for (const { cycle, interval, cents } of CYCLES) {
      const lookupKey = priceLookupKey(plan, cycle)
      const amount = offer[cents]
      const [current] = (await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 })).data
      if (current?.active && current.unit_amount === amount) {
        log(
          `${mode} ${lookupKey}: ${amount / 100} ${CURRENCY.toUpperCase()} a ${interval}, already there`,
        )
        continue
      }
      await stripe.prices.create({
        product: product.id,
        currency: CURRENCY,
        unit_amount: amount,
        recurring: { interval },
        lookup_key: lookupKey,
        transfer_lookup_key: true,
      })
      if (current) await stripe.prices.update(current.id, { active: false })
      log(`${mode} ${lookupKey}: ${amount / 100} ${CURRENCY.toUpperCase()} a ${interval}, created`)
    }
  }

  const range = `${TOP_UP.minCents / 100} to ${TOP_UP.maxCents / 100} ${CURRENCY.toUpperCase()}`
  const { created } = await ensureCreditsPrice(stripe)
  log(`${mode} ${TOP_UP_LOOKUP_KEY}: ${range}, ${created ? 'created' : 'already there'}`)
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  await syncPrices(new Stripe(key))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
