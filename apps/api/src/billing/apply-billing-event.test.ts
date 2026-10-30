import { randomUUID } from 'node:crypto'

import type { OrganizationRow } from '@arrakit/db'
import { organizations } from '@arrakit/db/schema'
import { type TestData, openTestData } from '@arrakit/db/testing'
import type { Plan } from '@arrakit/plans'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { fakeStripe } from '../testing/fake-stripe'
import { applyBillingEvent } from './apply-billing-event'
import type { SubscriptionState } from './stripe-gateway'

let data: TestData
let slugs = 0

beforeAll(async () => {
  data = await openTestData()
})
afterAll(() => data.close())

async function organization(initial: Partial<OrganizationRow> = {}): Promise<OrganizationRow> {
  slugs += 1
  const [row] = await data.db
    .insert(organizations)
    .values({ name: 'Alder', slug: `alder-${slugs}`, ...initial })
    .returning()
  return row!
}

const read = async (id: string) => (await data.forOrganization(id).organization())!

function stripeWith(organizationId: string | null, state: Partial<SubscriptionState> = {}) {
  const stripe = fakeStripe()
  slugs += 1
  stripe.subscribe({
    id: 'sub_1',
    customerId: `cus_${slugs}`,
    organizationId,
    status: 'active',
    lookupKey: 'pro_yearly',
    ...state,
  })
  return stripe
}

const event = (organizationId: string | null = null, subscriptionId: string | null = 'sub_1') => ({
  kind: 'subscription' as const,
  subscriptionId,
  organizationId,
})

describe('applyBillingEvent', () => {
  it("counts the plan's monthly grant from the subscription's billing anchor", async () => {
    const org = await organization()
    const anchor = new Date('2026-10-04T12:00:00Z')
    await applyBillingEvent(data, stripeWith(org.id, { anchor }), event())
    expect((await read(org.id)).usageAnchor).toEqual(anchor)
  })

  it('puts the organization on the plan an active subscription pays for, recording its customer and subscription', async () => {
    const org = await organization()
    const outcome = await applyBillingEvent(data, stripeWith(org.id), event())
    expect(outcome).toMatchObject({ kind: 'applied', organizationId: org.id, plan: 'pro' })
    expect(await read(org.id)).toMatchObject({
      plan: 'pro',
      stripeCustomerId: expect.stringMatching(/^cus_/),
      stripeSubscriptionId: 'sub_1',
    })
  })

  it('says which plan the organization was on before: Free on the first payment, Pro on a replay', async () => {
    const org = await organization()
    const stripe = stripeWith(org.id, { requestedBy: 'lucia@alder.vc' })
    expect(await applyBillingEvent(data, stripe, event())).toMatchObject({
      kind: 'applied',
      previousPlan: 'free',
      plan: 'pro',
      organization: { name: 'Alder', slug: org.slug },
      subscription: { lookupKey: 'pro_yearly', requestedBy: 'lucia@alder.vc' },
    })
    expect(await applyBillingEvent(data, stripe, event())).toMatchObject({
      previousPlan: 'pro',
      plan: 'pro',
    })
  })

  it.each(['active', 'canceled'])(
    'never moves an organization off the internal plan on a %s subscription',
    async (status) => {
      const org = await organization({ plan: 'internal' })
      const stripe = stripeWith(org.id, { status, lookupKey: 'team_monthly' })
      expect(await applyBillingEvent(data, stripe, event())).toMatchObject({ kind: 'ignored' })
      expect((await read(org.id)).plan).toBe('internal')
    },
  )

  it('lands on the same state when Stripe delivers the event twice', async () => {
    const org = await organization()
    const stripe = stripeWith(org.id)
    await applyBillingEvent(data, stripe, event())
    const once = await read(org.id)
    await applyBillingEvent(data, stripe, event())
    expect(await read(org.id)).toEqual(once)
  })

  it.each(['canceled', 'unpaid'])(
    'puts the organization back on Free once its subscription is %s, keeping the customer',
    async (status) => {
      const org = await organization({
        plan: 'pro' as Plan,
        stripeCustomerId: `cus_${status}`,
        stripeSubscriptionId: 'sub_1',
        usageAnchor: new Date(),
      })
      const stripe = stripeWith(org.id, { status, customerId: `cus_${status}` })
      expect(await applyBillingEvent(data, stripe, event())).toMatchObject({
        kind: 'applied',
        plan: 'free',
      })
      expect(await read(org.id)).toMatchObject({
        plan: 'free',
        stripeCustomerId: `cus_${status}`,
        stripeSubscriptionId: null,
        usageAnchor: null,
      })
    },
  )

  it('keeps the plan when an old subscription the organization has replaced is cancelled', async () => {
    const org = await organization({
      plan: 'team',
      stripeCustomerId: 'cus_replaced',
      stripeSubscriptionId: 'sub_2',
    })
    const stripe = stripeWith(org.id, { status: 'canceled', customerId: 'cus_replaced' })
    expect(await applyBillingEvent(data, stripe, event())).toEqual({
      kind: 'ignored',
      reason: 'subscription sub_1 was replaced',
    })
    expect(await read(org.id)).toMatchObject({ plan: 'team', stripeSubscriptionId: 'sub_2' })
  })

  it('takes the organization from the event when the subscription carries none', async () => {
    const org = await organization()
    const outcome = await applyBillingEvent(data, stripeWith(null), event(org.id))
    expect(outcome).toMatchObject({ kind: 'applied', organizationId: org.id, plan: 'pro' })
    expect((await read(org.id)).plan).toBe('pro')
  })

  it.each([
    ['no subscription', event(null, null), null],
    ['no organization named anywhere', event(), null],
    ['an organization that is gone', event(), randomUUID()],
    ['a malformed organization id', event(), 'not-a-uuid'],
  ])('ignores an event with %s, writing nothing', async (_, given, subscriptionOrganization) => {
    const org = await organization()
    const outcome = await applyBillingEvent(data, stripeWith(subscriptionOrganization), given)
    expect(outcome.kind).toBe('ignored')
    expect(await read(org.id)).toMatchObject({ plan: 'free', stripeCustomerId: null })
  })
})
