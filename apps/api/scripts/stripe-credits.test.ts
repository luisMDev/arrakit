import type Stripe from 'stripe'
import { describe, expect, it } from 'vitest'

import { TOP_UP_LOOKUP_KEY } from '../src/billing/real-stripe'
import { CREDITS_AMOUNT, ensureCreditsPrice, priceMatches } from './stripe-credits'

interface FakePrice {
  id: string
  product: string
  active: boolean
  currency: string
  lookup_key: string | null
  custom_unit_amount: { minimum: number; maximum: number; preset: number } | null
}

function fakeStripeApi(seed: { products?: { id: string }[]; prices?: FakePrice[] } = {}) {
  const products = [...(seed.products ?? [])]
  const prices = [...(seed.prices ?? [])]
  const api = {
    products: {
      search: async () => ({ data: products }),
      create: async () => {
        const product = { id: `prod_${products.length + 1}` }
        products.push(product)
        return product
      },
    },
    prices: {
      list: async ({ lookup_keys }: { lookup_keys: string[] }) => ({
        data: prices.filter((p) => p.active && lookup_keys.includes(p.lookup_key ?? '')),
      }),
      create: async (params: {
        product: string
        currency: string
        lookup_key: string
        custom_unit_amount: { minimum: number; maximum: number; preset: number }
      }) => {
        for (const p of prices) if (p.lookup_key === params.lookup_key) p.lookup_key = null
        const price: FakePrice = {
          id: `price_${prices.length + 1}`,
          active: true,
          product: params.product,
          currency: params.currency,
          lookup_key: params.lookup_key,
          custom_unit_amount: params.custom_unit_amount,
        }
        prices.push(price)
        return price
      },
      update: async (id: string, { active }: { active: boolean }) => {
        const price = prices.find((p) => p.id === id)!
        price.active = active
        return price
      },
    },
  }
  return { api: api as unknown as Pick<Stripe, 'products' | 'prices'>, products, prices }
}

describe('stripe-credits script', () => {
  it('creates the product and price, then keeps them', async () => {
    const fake = fakeStripeApi()
    const first = await ensureCreditsPrice(fake.api)
    expect(first.created).toBe(true)
    expect(fake.prices[0]).toMatchObject({
      lookup_key: TOP_UP_LOOKUP_KEY,
      currency: 'usd',
      custom_unit_amount: { minimum: 1_000, maximum: 50_000, preset: 2_000 },
    })
    const second = await ensureCreditsPrice(fake.api)
    expect(second).toEqual({ ...first, created: false })
    expect(fake.products).toHaveLength(1)
  })

  it('replaces a price whose bounds changed and deactivates the old one', async () => {
    const fake = fakeStripeApi({
      products: [{ id: 'prod_1' }],
      prices: [
        {
          id: 'price_old',
          product: 'prod_1',
          active: true,
          currency: 'usd',
          lookup_key: TOP_UP_LOOKUP_KEY,
          custom_unit_amount: { minimum: 500, maximum: 50_000, preset: 1_000 },
        },
      ],
    })
    const result = await ensureCreditsPrice(fake.api)
    expect(result.created).toBe(true)
    expect(fake.prices.find((p) => p.id === 'price_old')?.active).toBe(false)
  })

  it('matches prices by currency and bounds', () => {
    const custom_unit_amount = { ...CREDITS_AMOUNT, enabled: true } as never
    expect(priceMatches({ active: true, currency: 'usd', custom_unit_amount })).toBe(true)
    expect(priceMatches({ active: true, currency: 'eur', custom_unit_amount })).toBe(false)
    expect(priceMatches({ active: false, currency: 'usd', custom_unit_amount })).toBe(false)
    expect(priceMatches({ active: true, currency: 'usd', custom_unit_amount: null })).toBe(false)
  })
})
