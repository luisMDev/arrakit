import type { Plan } from '@arrakit/plans'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { creditLedger, organizations, usageLevels } from '../schema/index'
import { type TestData, openTestData } from '../testing'
import { UsageLimitError } from './usage'

const DAY = 24 * 60 * 60 * 1000

describe('forOrganization().usage', () => {
  let data: TestData
  let clock = new Date('2026-10-08T12:00:00Z')
  let counter = 0

  beforeAll(async () => {
    data = await openTestData({ now: () => clock })
  })
  afterAll(() => data.close())
  beforeEach(() => {
    clock = new Date('2026-10-08T12:00:00Z')
  })

  async function newOrganization(
    plan: Plan = 'free',
    options: { createdAt?: Date; usageAnchor?: Date | null } = {},
  ) {
    counter += 1
    const [org] = await data.db
      .insert(organizations)
      .values({
        name: `Org ${counter}`,
        slug: `org-${counter}`,
        plan,
        createdAt: options.createdAt ?? new Date(clock.getTime() - DAY),
        usageAnchor: options.usageAnchor ?? null,
      })
      .returning()
    return { id: org!.id, usage: data.forOrganization(org!.id).usage }
  }

  const metric = async (
    usage: ReturnType<typeof data.forOrganization>['usage'],
    key: 'credits' | 'storage_gb',
  ) => (await usage.summary()).find((m) => m.metric === key)!

  it('grants Free $1 a month: 100 credits and 10 GB', async () => {
    const { usage } = await newOrganization()
    const summary = await usage.summary()
    expect(summary.map((m) => m.metric)).toEqual(['credits', 'storage_gb'])
    expect(summary[0]).toMatchObject({
      kind: 'consumable',
      granted: 100,
      plan: 100,
      purchased: 0,
      used: 0,
      available: 100,
      limit: null,
    })
    expect(summary[1]).toMatchObject({
      kind: 'capacity',
      granted: 10,
      plan: 10,
      used: 0,
      available: 10,
      limit: 10,
    })
    expect(summary[0]!.resetsOn.getTime()).toBeGreaterThan(clock.getTime() + 27 * DAY - DAY)
  })

  it('writes the grant once however many reads race', async () => {
    const { id, usage } = await newOrganization()
    await Promise.all([usage.summary(), usage.summary(), usage.summary()])
    const grants = await data.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.organizationId, id))
    expect(grants.filter((g) => g.metric === 'credits')).toHaveLength(1)
    expect((await metric(usage, 'credits')).granted).toBe(100)
  })

  it('spends the plan first, then purchased', async () => {
    const { usage } = await newOrganization()
    expect(await usage.credit(2_000, { idempotencyKey: 'checkout:cs_1' })).toBe(true)
    expect(await metric(usage, 'credits')).toMatchObject({
      plan: 100,
      purchased: 2_000,
      available: 2_100,
    })
    const after = await usage.consume('credits', 150, { idempotencyKey: 'job-1' })
    expect(after).toMatchObject({ plan: 0, purchased: 1_950, used: 150, available: 1_950 })
    expect(await metric(usage, 'credits')).toMatchObject({
      plan: 0,
      purchased: 1_950,
      used: 150,
      available: 1_950,
    })
  })

  it('adds a top-up to every metric', async () => {
    const { usage } = await newOrganization()
    await usage.credit(2_000, { idempotencyKey: 'checkout:cs_2' })
    expect(await metric(usage, 'storage_gb')).toMatchObject({ purchased: 200, limit: 210 })
  })

  it('credits a top-up once per key, even concurrently', async () => {
    const { usage } = await newOrganization()
    const results = await Promise.all([
      usage.credit(1_000, { idempotencyKey: 'checkout:cs_3' }),
      usage.credit(1_000, { idempotencyKey: 'checkout:cs_3' }),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect((await metric(usage, 'credits')).purchased).toBe(1_000)
  })

  it('refuses a use it cannot cover, spending nothing', async () => {
    const { usage } = await newOrganization()
    const error = await usage
      .consume('credits', 101, { idempotencyKey: 'big' })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UsageLimitError)
    expect(error).toMatchObject({ metric: 'credits', requested: 101, available: 100 })
    expect((error as Error).message).toContain('Add credits in Settings → Billing')
    expect((await metric(usage, 'credits')).used).toBe(0)
  })

  it('spends a retried use once', async () => {
    const { usage } = await newOrganization()
    await usage.consume('credits', 30, { idempotencyKey: 'report:1' })
    await usage.consume('credits', 30, { idempotencyKey: 'report:1' })
    expect((await metric(usage, 'credits')).used).toBe(30)
  })

  it('never lets two concurrent uses pass one balance', async () => {
    const { usage } = await newOrganization()
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((n) => usage.consume('credits', 30, { idempotencyKey: `use-${n}` })),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
    expect(await metric(usage, 'credits')).toMatchObject({ used: 90, available: 10 })
  })

  it('checks without spending', async () => {
    const { usage } = await newOrganization()
    expect(await usage.check('credits', 100)).toEqual({
      metric: 'credits',
      allowed: true,
      available: 100,
      requested: 100,
    })
    expect((await usage.check('credits', 101)).allowed).toBe(false)
    expect((await usage.check('storage_gb', 11)).allowed).toBe(false)
    expect((await metric(usage, 'credits')).used).toBe(0)
    await expect(usage.check('nope' as never)).rejects.toThrow('no metric nope in METRICS')
    await expect(usage.check('credits', -1)).rejects.toThrow(/whole number/)
  })

  it("lapses last month's grant and keeps purchased", async () => {
    const anchor = new Date(clock.getTime() - 5 * DAY)
    const { id, usage } = await newOrganization('pro', { usageAnchor: anchor })
    await usage.credit(1_000, { idempotencyKey: 'checkout:cs_4' })
    await usage.consume('credits', 1_200, { idempotencyKey: 'big-job' })
    expect(await metric(usage, 'credits')).toMatchObject({ plan: 0, purchased: 800 })

    await data.db
      .update(organizations)
      .set({ usageAnchor: new Date(clock.getTime() - DAY) })
      .where(eq(organizations.id, id))
    expect(await metric(usage, 'credits')).toMatchObject({
      granted: 1_000,
      plan: 1_000,
      purchased: 800,
      used: 0,
    })
  })

  it('starts a new month when the clock moves past the reset', async () => {
    const { usage } = await newOrganization()
    await usage.consume('credits', 60, { idempotencyKey: 'a' })
    const { resetsOn } = await metric(usage, 'credits')
    clock = new Date(resetsOn.getTime() + 1_000)
    expect(await metric(usage, 'credits')).toMatchObject({ granted: 100, plan: 100, used: 0 })
  })

  it('tops the grant up on an upgrade mid-month', async () => {
    const { id, usage } = await newOrganization('pro')
    await usage.consume('credits', 400, { idempotencyKey: 'work' })
    await data.db.update(organizations).set({ plan: 'team' }).where(eq(organizations.id, id))
    expect(await metric(usage, 'credits')).toMatchObject({ granted: 3_000, plan: 2_600 })
  })

  it('keeps what was granted on a downgrade mid-month', async () => {
    const { id, usage } = await newOrganization('team')
    await usage.summary()
    await data.db.update(organizations).set({ plan: 'free' }).where(eq(organizations.id, id))
    expect((await metric(usage, 'credits')).granted).toBe(3_000)
  })

  it('limits a capacity metric by its level', async () => {
    const { usage } = await newOrganization()
    expect(await usage.set('storage_gb', 8)).toMatchObject({ used: 8, available: 2 })
    const error = await usage.set('storage_gb', 11).catch((e: unknown) => e)
    expect(error).toMatchObject({ name: 'UsageLimitError', requested: 3, available: 2 })
    expect((error as Error).message).toContain('Storage limit reached')
    await usage.credit(1_000, { idempotencyKey: 'checkout:cs_5' })
    expect(await usage.set('storage_gb', 11)).toMatchObject({ used: 11, limit: 110 })
    expect(await usage.set('storage_gb', 0)).toMatchObject({ used: 0 })
  })

  it('reverses a refund proportionally from every metric, once per key', async () => {
    const { usage } = await newOrganization()
    await usage.credit(2_000, { idempotencyKey: 'checkout:cs_6' })
    expect(await usage.reverse(1_000, { idempotencyKey: 'reversal:re_1' })).toBe(true)
    expect(await usage.reverse(1_000, { idempotencyKey: 'reversal:re_1' })).toBe(false)
    expect((await metric(usage, 'credits')).purchased).toBe(1_000)
    expect((await metric(usage, 'storage_gb')).purchased).toBe(100)
  })

  it('lets a refund drive purchased below zero, paid by the next top-up', async () => {
    const { usage } = await newOrganization()
    await usage.credit(1_000, { idempotencyKey: 'checkout:cs_7' })
    await usage.consume('credits', 1_100, { idempotencyKey: 'all' })
    await usage.reverse(1_000, { idempotencyKey: 'reversal:re_2' })
    expect(await metric(usage, 'credits')).toMatchObject({ purchased: 0, available: 0 })
    await usage.credit(2_000, { idempotencyKey: 'checkout:cs_8' })
    expect((await metric(usage, 'credits')).purchased).toBe(1_000)
  })

  it('never reverses more than a payment bought, across refunds and disputes', async () => {
    const { usage } = await newOrganization()
    await usage.credit(1_000, { idempotencyKey: 'checkout:cs_10' })
    const payment = { key: 'pi_1', cents: 1_000 }
    expect(await usage.reverse(500, { idempotencyKey: 'refund:re_4', payment })).toBe(true)
    expect(await usage.reverse(500, { idempotencyKey: 'refund:re_4', payment })).toBe(false)
    expect(await usage.reverse(1_000, { idempotencyKey: 'dispute:dp_1', payment })).toBe(true)
    expect(await usage.reverse(1_000, { idempotencyKey: 'dispute:dp_2', payment })).toBe(false)
    expect(await metric(usage, 'credits')).toMatchObject({ purchased: 0, available: 100 })
    expect(await metric(usage, 'storage_gb')).toMatchObject({ purchased: 0, limit: 10 })
  })

  it('caps concurrent reversals of one payment at what it bought', async () => {
    const { usage } = await newOrganization()
    await usage.credit(1_000, { idempotencyKey: 'checkout:cs_11' })
    const payment = { key: 'pi_2', cents: 1_000 }
    const results = await Promise.all(
      [1, 2, 3].map((n) => usage.reverse(600, { idempotencyKey: `re_c${n}`, payment })),
    )
    expect(results.filter(Boolean)).toHaveLength(2)
    expect((await metric(usage, 'credits')).purchased).toBe(0)
  })

  it('caps reversals per payment, not across payments', async () => {
    const { usage } = await newOrganization()
    await usage.credit(1_000, { idempotencyKey: 'checkout:cs_12' })
    await usage.credit(1_000, { idempotencyKey: 'checkout:cs_13' })
    await usage.reverse(1_000, { idempotencyKey: 're_p1', payment: { key: 'pi_3', cents: 1_000 } })
    await usage.reverse(1_000, { idempotencyKey: 're_p2', payment: { key: 'pi_4', cents: 1_000 } })
    expect((await metric(usage, 'credits')).purchased).toBe(0)
  })

  it('keeps the caps of payments apart when one payment key starts with another', async () => {
    const { usage } = await newOrganization()
    await usage.credit(1_000, { idempotencyKey: 'checkout:cs_14' })
    await usage.credit(1_000, { idempotencyKey: 'checkout:cs_15' })
    const first = { key: 'pi_5', cents: 1_000 }
    const second = { key: 'pi_5:x', cents: 1_000 }
    expect(await usage.reverse(1_000, { idempotencyKey: 're_x', payment: second })).toBe(true)
    expect(await usage.reverse(1_000, { idempotencyKey: 're_y', payment: first })).toBe(true)
    expect((await metric(usage, 'credits')).purchased).toBe(0)
  })

  it('keeps a capacity limit at 0 when adjustments take back more than it had', async () => {
    const { usage } = await newOrganization()
    await usage.adjust('storage_gb', -50, { idempotencyKey: 'clawback' })
    expect(await metric(usage, 'storage_gb')).toMatchObject({
      purchased: -50,
      available: 0,
      limit: 0,
    })
    await expect(usage.set('storage_gb', 1)).rejects.toBeInstanceOf(UsageLimitError)
    expect(await usage.set('storage_gb', 0)).toMatchObject({ used: 0, limit: 0 })
  })

  it('adjusts by hand once per key', async () => {
    const { usage } = await newOrganization()
    expect(await usage.adjust('credits', 50, { idempotencyKey: 'goodwill' })).toBe(true)
    expect(await usage.adjust('credits', 50, { idempotencyKey: 'goodwill' })).toBe(false)
    expect((await metric(usage, 'credits')).available).toBe(150)
    await expect(usage.adjust('credits', 0, { idempotencyKey: 'zero' })).rejects.toThrow(
      'other than 0',
    )
  })

  it('refuses malformed uses', async () => {
    const { usage } = await newOrganization()
    await expect(usage.consume('storage_gb', 1, { idempotencyKey: 'x' })).rejects.toThrow(
      /capacity/,
    )
    await expect(usage.consume('credits', 1.5, { idempotencyKey: 'x' })).rejects.toThrow(
      /whole number/,
    )
    await expect(usage.consume('credits', 1, { idempotencyKey: '  ' })).rejects.toThrow(
      'must not be blank',
    )
  })

  it('keeps balances per organization', async () => {
    const a = await newOrganization()
    const b = await newOrganization()
    await a.usage.consume('credits', 40, { idempotencyKey: 'same' })
    await b.usage.consume('credits', 10, { idempotencyKey: 'same' })
    expect((await metric(a.usage, 'credits')).used).toBe(40)
    expect((await metric(b.usage, 'credits')).used).toBe(10)
  })

  it('lists top-ups newest first, not reduced by refunds', async () => {
    const { usage } = await newOrganization()
    await usage.credit(1_000, { idempotencyKey: 'checkout:old' })
    clock = new Date(clock.getTime() + 1_000)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await usage.credit(2_500, { idempotencyKey: 'checkout:new' })
    await usage.reverse(1_000, { idempotencyKey: 'reversal:re_3' })
    const topUps = await usage.topUps()
    expect(topUps.map((t) => t.cents)).toEqual([2_500, 1_000])
    expect(topUps[0]!.amounts).toEqual({ credits: 2_500, storage_gb: 250 })
  })

  it('cascades the ledger and levels when the organization is deleted', async () => {
    const { id, usage } = await newOrganization()
    await usage.credit(1_000, { idempotencyKey: 'checkout:cs_9' })
    await usage.set('storage_gb', 3)
    await data.db.delete(organizations).where(eq(organizations.id, id))
    expect(
      await data.db.select().from(creditLedger).where(eq(creditLedger.organizationId, id)),
    ).toEqual([])
    expect(
      await data.db.select().from(usageLevels).where(eq(usageLevels.organizationId, id)),
    ).toEqual([])
    await expect(usage.summary()).rejects.toThrow(/gone/)
  })
})
