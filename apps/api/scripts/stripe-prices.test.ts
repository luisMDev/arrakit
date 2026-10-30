import type Stripe from 'stripe'
import { describe, expect, it } from 'vitest'

import { TOP_UP_LOOKUP_KEY } from '../src/billing/real-stripe'
import { CREDITS_AMOUNT, ensureCreditsPrice, priceMatches, syncPrices } from './stripe-prices'

interface FakePrice {
  id: string
  active: boolean
  unit_amount: number | null
  currency: string
  lookup_key: string | null
  metadata: Record<string, string>
  custom_unit_amount?: { minimum: number; maximum: number } | null
}

function stripeAccount(prices: FakePrice[] = []) {
  const created: Record<string, unknown>[] = []
  const updated: { id: string; params: unknown }[] = []
  const client = {
    balance: { retrieve: async () => ({ livemode: false }) },
    products: {
      search: async () => ({ data: [] }),
      create: async (params: { metadata: Record<string, string> }) => ({
        id: `prod_${Object.values(params.metadata)[0]}`,
      }),
    },
    prices: {
      list: async ({ lookup_keys }: { lookup_keys: string[] }) => ({
        data: prices.filter((price) => price.lookup_key === lookup_keys[0]),
      }),
      create: async (params: Record<string, unknown>) => {
        created.push(params)
        return { id: `price_${created.length}` }
      },
      update: async (id: string, params: unknown) => {
        updated.push({ id, params })
        return {}
      },
    },
  }
  return { client: client as unknown as Stripe, created, updated }
}

describe('syncPrices', () => {
  it('creates every plan price by lookup key, and the Credits price, in an empty account', async () => {
    const account = stripeAccount()
    const lines: string[] = []
    await syncPrices(account.client, (line) => lines.push(line))
    expect(account.created.map((price) => price.lookup_key)).toEqual([
      'arrakit_pro_monthly',
      'arrakit_pro_yearly',
      'arrakit_team_monthly',
      'arrakit_team_yearly',
      'arrakit_credits_top_up',
    ])
    expect(account.created[1]).toMatchObject({
      unit_amount: 19_200,
      recurring: { interval: 'year' },
      transfer_lookup_key: true,
    })
    expect(account.created[4]).toMatchObject({
      custom_unit_amount: { enabled: true, minimum: 1_000, maximum: 50_000, preset: 2_000 },
    })
    expect(lines[0]).toBe('test arrakit_pro_monthly: 20 USD a month, created')
  })

  it('keeps a price already there and replaces one whose amount changed', async () => {
    const account = stripeAccount([
      {
        id: 'price_old',
        active: true,
        unit_amount: 1_900,
        currency: 'usd',
        lookup_key: 'arrakit_pro_monthly',
        metadata: { plan: 'pro', cycle: 'monthly' },
      },
      {
        id: 'price_same',
        active: true,
        unit_amount: 19_200,
        currency: 'usd',
        lookup_key: 'arrakit_pro_yearly',
        metadata: {},
      },
    ])
    await syncPrices(account.client, () => undefined)
    expect(account.created.map((price) => price.lookup_key)).not.toContain('arrakit_pro_yearly')
    expect(account.updated).toEqual([{ id: 'price_old', params: { active: false } }])
  })
})

interface FakeCreditsPrice {
  id: string
  product: string
  active: boolean
  currency: string
  lookup_key: string | null
  custom_unit_amount: { minimum: number; maximum: number; preset: number } | null
}

function fakeStripeApi(seed: { products?: { id: string }[]; prices?: FakeCreditsPrice[] } = {}) {
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
        const price: FakeCreditsPrice = {
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

describe('ensureCreditsPrice', () => {
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
