import type Stripe from 'stripe'
import { describe, expect, it } from 'vitest'

import { syncPrices } from './stripe-prices'

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
