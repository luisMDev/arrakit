import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { memoryJobs } from '../jobs/memory'
import { type Data, openData } from '../open-data'
import { organizations } from '../schema/index'
import { memoryStorage } from '../storage/memory'
import { stackEnv } from '../testing'

describe('usage under real Postgres concurrency', () => {
  let data: Data

  beforeAll(async () => {
    data = await openData(
      { databaseUrl: stackEnv().DATABASE_URL },
      { storage: memoryStorage(), jobs: memoryJobs() },
    )
  })
  afterAll(async () => {
    await data?.close()
  })

  async function newOrganization() {
    const [org] = await data.db
      .insert(organizations)
      .values({ name: 'Race', slug: `race-${randomUUID()}`, plan: 'free' })
      .returning()
    return { id: org!.id, usage: data.asSystem(org!.id).usage }
  }

  async function cleanup(id: string) {
    await data.db.delete(organizations).where(eq(organizations.id, id))
  }

  it('never lets concurrent uses pass one balance', async () => {
    const { id, usage } = await newOrganization()
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, n) =>
          usage.consume('credits', 30, { idempotencyKey: `race-${n}` }),
        ),
      )
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
      const credits = (await usage.summary()).find((m) => m.metric === 'credits')!
      expect(credits).toMatchObject({ used: 90, available: 10 })
    } finally {
      await cleanup(id)
    }
  })

  it('caps concurrent reversals of one payment at what it bought', async () => {
    const { id, usage } = await newOrganization()
    try {
      await usage.credit(1_000, { idempotencyKey: 'checkout:race' })
      const payment = { key: 'pi_race', cents: 1_000 }
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, n) =>
          usage.reverse(400, { idempotencyKey: `re_race_${n}`, payment }),
        ),
      )
      expect(results.filter(Boolean)).toHaveLength(3)
      const credits = (await usage.summary()).find((m) => m.metric === 'credits')!
      expect(credits.purchased).toBe(0)
    } finally {
      await cleanup(id)
    }
  })
})
