import { randomUUID } from 'node:crypto'

import type { OrganizationRow } from '@arrakit/db'
import { organizations } from '@arrakit/db/schema'
import { type TestData, openTestData } from '@arrakit/db/testing'
import type { Plan } from '@arrakit/plans'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { recordingLogger } from '../observability/logger'
import { fakeStripe } from './fake-stripe'
import { applyBillingEvent } from './settle-event'
import type { StripeGateway, SubscriptionEvent, SubscriptionState } from './stripe-gateway'

let data: TestData
let slugs = 0

beforeAll(async () => {
  data = await openTestData()
})
afterAll(() => data.close())

let recorded = recordingLogger()
beforeEach(() => {
  recorded = recordingLogger()
})

const apply = (stripe: Pick<StripeGateway, 'subscription' | 'endNow'>, given: SubscriptionEvent) =>
  applyBillingEvent(data, stripe, recorded.log, given)

const warned = (msg: string) => recorded.logs.filter((entry) => entry.msg === msg)

async function organization(initial: Partial<OrganizationRow> = {}): Promise<OrganizationRow> {
  slugs += 1
  const [row] = await data.db
    .insert(organizations)
    .values({ name: 'Alder', slug: `alder-${slugs}`, ...initial })
    .returning()
  return row!
}

const read = async (id: string) => (await data.asSystem(id).organization())!

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
    await apply(stripeWith(org.id, { anchor }), event())
    expect((await read(org.id)).usageAnchor).toEqual(anchor)
  })

  it('puts the organization on the plan an active subscription pays for, recording its customer and subscription', async () => {
    const org = await organization()
    expect(await apply(stripeWith(org.id), event())).toMatchObject({ plan: 'pro' })
    expect(await read(org.id)).toMatchObject({
      plan: 'pro',
      stripeCustomerId: expect.stringMatching(/^cus_/),
      stripeSubscriptionId: 'sub_1',
    })
  })

  it('says which plan the organization was on before: Free on the first payment, Pro on a replay', async () => {
    const org = await organization()
    const stripe = stripeWith(org.id)
    expect(await apply(stripe, event())).toMatchObject({
      organization: { id: org.id, name: 'Alder', plan: 'free' },
      plan: 'pro',
      subscription: { lookupKey: 'pro_yearly' },
    })
    expect(await apply(stripe, event())).toMatchObject({
      organization: { plan: 'pro' },
      plan: 'pro',
    })
  })

  it.each(['active', 'canceled'])(
    'never moves an organization off the internal plan on a %s subscription',
    async (status) => {
      const org = await organization({ plan: 'internal' })
      const stripe = stripeWith(org.id, { status, lookupKey: 'team_monthly' })
      expect(await apply(stripe, event())).toBeNull()
      expect(warned('billing event ignored')).toHaveLength(1)
      expect((await read(org.id)).plan).toBe('internal')
    },
  )

  it('lands on the same state when Stripe delivers the event twice', async () => {
    const org = await organization()
    const stripe = stripeWith(org.id)
    await apply(stripe, event())
    const once = await read(org.id)
    await apply(stripe, event())
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
      expect(await apply(stripe, event())).toMatchObject({ plan: 'free' })
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
    expect(await apply(stripe, event())).toBeNull()
    expect(warned('billing event ignored')).toEqual([
      expect.objectContaining({ reason: 'subscription sub_1 was replaced' }),
    ])
    expect(await read(org.id)).toMatchObject({ plan: 'team', stripeSubscriptionId: 'sub_2' })
  })

  it('ends a second live subscription at once, keeping the one the organization pays with', async () => {
    const org = await organization()
    const stripe = stripeWith(org.id)
    stripe.subscribe({
      id: 'sub_2',
      customerId: 'cus_twin',
      organizationId: org.id,
      status: 'active',
      lookupKey: 'team_monthly',
    })
    await apply(stripe, event())
    expect(await apply(stripe, event(null, 'sub_2'))).toBeNull()
    expect(warned('duplicate subscription ended')).toEqual([
      expect.objectContaining({ organizationId: org.id, kept: 'sub_1', ended: 'sub_2' }),
    ])
    expect(stripe.ended).toEqual(['sub_2'])
    expect(await read(org.id)).toMatchObject({ plan: 'pro', stripeSubscriptionId: 'sub_1' })
  })

  it('settles the ended duplicate, and a replay of either, without moving the plan', async () => {
    const org = await organization()
    const stripe = stripeWith(org.id)
    stripe.subscribe({
      id: 'sub_2',
      customerId: 'cus_twin',
      organizationId: org.id,
      status: 'active',
      lookupKey: 'team_monthly',
    })
    await apply(stripe, event())
    await apply(stripe, event(null, 'sub_2'))
    expect(await apply(stripe, event(null, 'sub_2'))).toBeNull()
    expect(warned('billing event ignored')).toHaveLength(1)
    expect(await apply(stripe, event())).toMatchObject({ plan: 'pro' })
    expect(stripe.ended).toEqual(['sub_2'])
    expect(await read(org.id)).toMatchObject({ plan: 'pro', stripeSubscriptionId: 'sub_1' })
  })

  it('takes a new subscription once the one it replaces has ended', async () => {
    const org = await organization({
      plan: 'pro' as Plan,
      stripeCustomerId: 'cus_moved',
      stripeSubscriptionId: 'sub_1',
    })
    const stripe = stripeWith(org.id, { status: 'canceled', customerId: 'cus_moved' })
    stripe.subscribe({
      id: 'sub_2',
      customerId: 'cus_moved',
      organizationId: org.id,
      status: 'active',
      lookupKey: 'team_yearly',
    })
    expect(await apply(stripe, event(null, 'sub_2'))).toMatchObject({ plan: 'team' })
    expect(stripe.ended).toEqual([])
    expect(await read(org.id)).toMatchObject({ plan: 'team', stripeSubscriptionId: 'sub_2' })
  })

  it('takes the organization from the event when the subscription carries none', async () => {
    const org = await organization()
    expect(await apply(stripeWith(null), event(org.id))).toMatchObject({
      organization: { id: org.id },
      plan: 'pro',
    })
    expect((await read(org.id)).plan).toBe('pro')
  })

  it.each([
    ['no subscription', event(null, null), null],
    ['no organization named anywhere', event(), null],
    ['an organization that is gone', event(), randomUUID()],
    ['a malformed organization id', event(), 'not-a-uuid'],
  ])('ignores an event with %s, writing nothing', async (_, given, subscriptionOrganization) => {
    const org = await organization()
    expect(await apply(stripeWith(subscriptionOrganization), given)).toBeNull()
    expect(warned('billing event ignored')).toHaveLength(1)
    expect(await read(org.id)).toMatchObject({ plan: 'free', stripeCustomerId: null })
  })
})
