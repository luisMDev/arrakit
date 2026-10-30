import { pathToFileURL } from 'node:url'

import { APP_NAME } from '@arrakit/emails'
import { CURRENCY, PAID_PLANS, PLAN_LABELS, PLAN_OFFERS, TOP_UP } from '@arrakit/plans'
import Stripe from 'stripe'

import { TOP_UP_LOOKUP_KEY } from '../src/billing/real-stripe'
import { priceLookupKey } from '../src/billing/subscription-plan'

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
      const metadata = { plan, cycle }
      const [current] = (await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 })).data
      if (current?.active && current.unit_amount === amount) {
        if (current.metadata.plan !== plan || current.metadata.cycle !== cycle) {
          await stripe.prices.update(current.id, { metadata })
        }
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
        metadata,
      })
      if (current) await stripe.prices.update(current.id, { active: false })
      log(`${mode} ${lookupKey}: ${amount / 100} ${CURRENCY.toUpperCase()} a ${interval}, created`)
    }
  }

  const range = `${TOP_UP.minCents / 100} to ${TOP_UP.maxCents / 100} ${CURRENCY.toUpperCase()}`
  const creditsFound = await stripe.products.search({ query: "metadata['kind']:'credits'" })
  const credits =
    creditsFound.data[0] ??
    (await stripe.products.create({ name: `${APP_NAME} Credits`, metadata: { kind: 'credits' } }))
  const [creditsPrice] = (await stripe.prices.list({ lookup_keys: [TOP_UP_LOOKUP_KEY], limit: 1 }))
    .data
  const custom = creditsPrice?.custom_unit_amount
  if (
    creditsPrice?.active &&
    creditsPrice.currency === CURRENCY &&
    custom?.minimum === TOP_UP.minCents &&
    custom.maximum === TOP_UP.maxCents
  ) {
    log(`${mode} ${TOP_UP_LOOKUP_KEY}: ${range}, already there`)
    return
  }
  await stripe.prices.create({
    product: credits.id,
    currency: CURRENCY,
    custom_unit_amount: {
      enabled: true,
      minimum: TOP_UP.minCents,
      maximum: TOP_UP.maxCents,
      preset: Math.min(TOP_UP.minCents * 2, TOP_UP.maxCents),
    },
    lookup_key: TOP_UP_LOOKUP_KEY,
    transfer_lookup_key: true,
  })
  if (creditsPrice) await stripe.prices.update(creditsPrice.id, { active: false })
  log(`${mode} ${TOP_UP_LOOKUP_KEY}: ${range}, created`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  await syncPrices(new Stripe(key))
}
