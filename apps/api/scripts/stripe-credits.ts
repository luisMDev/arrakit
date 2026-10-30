import { APP_NAME } from '@arrakit/emails'
import { CURRENCY, TOP_UP } from '@arrakit/plans'
import Stripe from 'stripe'

import { TOP_UP_LOOKUP_KEY } from '../src/billing/real-stripe'
import { runScript } from './run-script'

type CreditsStripe = Pick<Stripe, 'products' | 'prices'>

interface CustomAmount {
  minimum: number
  maximum: number
  preset: number
}

export const CREDITS_AMOUNT: CustomAmount = {
  minimum: TOP_UP.minCents,
  maximum: TOP_UP.maxCents,
  preset: Math.min(TOP_UP.minCents * 2, TOP_UP.maxCents),
}

/** Does an existing price already sell top-ups as the catalog says? */
export function priceMatches(
  price: Pick<Stripe.Price, 'active' | 'currency' | 'custom_unit_amount'>,
  amount: CustomAmount = CREDITS_AMOUNT,
): boolean {
  const custom = price.custom_unit_amount
  return (
    price.active &&
    price.currency === CURRENCY &&
    custom?.minimum === amount.minimum &&
    custom?.maximum === amount.maximum
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

runScript(import.meta.url, async () => {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('Set STRIPE_SECRET_KEY to create the Credits product.')
  const result = await ensureCreditsPrice(new Stripe(key))
  console.info(
    `${result.created ? 'created' : 'kept'} price ${result.priceId} (${TOP_UP_LOOKUP_KEY}) on product ${result.productId}`,
  )
})
