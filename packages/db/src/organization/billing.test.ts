import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type TestData, insertOrganization, openTestData } from '../testing'

describe('organization billing', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  it('starts every organization on Free with no Stripe ids', async () => {
    const org = await insertOrganization(data, { slug: 'alder' })
    expect(org).toMatchObject({
      plan: 'free',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      usageAnchor: null,
    })
  })

  it('records the customer, the subscription and the anchor with a paid plan', async () => {
    const org = await insertOrganization(data, { slug: 'birch' })
    const anchor = new Date('2026-10-04T12:00:00Z')
    const row = await data
      .asSystem(org.id)
      .setPlan('pro', { customerId: 'cus_birch', subscriptionId: 'sub_birch', anchor })
    expect(row).toMatchObject({
      plan: 'pro',
      stripeCustomerId: 'cus_birch',
      stripeSubscriptionId: 'sub_birch',
      usageAnchor: anchor,
    })
  })

  it('keeps the customer when it goes back to Free alone, and clears the anchor', async () => {
    const org = await insertOrganization(data, { slug: 'cedar' })
    const scope = data.asSystem(org.id)
    await scope.setPlan('team', {
      customerId: 'cus_cedar',
      subscriptionId: 'sub_cedar',
      anchor: new Date(),
    })
    const row = await scope.setPlan('free')
    expect(row).toMatchObject({
      plan: 'free',
      stripeCustomerId: 'cus_cedar',
      stripeSubscriptionId: 'sub_cedar',
      usageAnchor: null,
    })
  })

  it('records the first Stripe customer and keeps it afterwards', async () => {
    const org = await insertOrganization(data, { slug: 'elm' })
    const scope = data.asSystem(org.id)
    expect((await scope.setStripeCustomer('cus_first'))?.stripeCustomerId).toBe('cus_first')
    expect((await scope.setStripeCustomer('cus_second'))?.stripeCustomerId).toBe('cus_first')
  })

  it('answers undefined for an unknown organization and never touches another', async () => {
    const other = await insertOrganization(data, { slug: 'fir' })
    const unknown = data.asSystem('0f8fad5b-d9cb-469f-a165-70867728950e')
    expect(await unknown.setPlan('pro', { customerId: 'cus_x', subscriptionId: 'sub_x' })).toBe(
      undefined,
    )
    expect(await unknown.setStripeCustomer('cus_x')).toBe(undefined)
    expect(await data.asSystem(other.id).organization()).toMatchObject({
      plan: 'free',
      stripeCustomerId: null,
    })
  })
})
