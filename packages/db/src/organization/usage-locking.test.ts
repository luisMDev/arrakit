import { randomUUID } from 'node:crypto'

import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type Database, defaultMigrationsFolder } from '../connection'
import { memoryJobs } from '../jobs/memory'
import { consoleLog } from '../log'
import { type Data, openData } from '../open-data'
import { toOrganizationId } from '../organization-id'
import * as schema from '../schema/index'
import { creditLedger, organizations } from '../schema/index'
import { memoryStorage } from '../storage/memory'
import { usageScope } from './usage'

/**
 * PGlite has one connection, so it serializes transactions and cannot show a race. These tests
 * pin the lock in the emitted SQL; the Postgres suite below proves it holds under real
 * concurrency and runs only when TEST_DATABASE_URL (or DATABASE_URL) points at a Postgres.
 */
describe('usage row lock (emitted SQL)', () => {
  const queries: string[] = []
  let client: PGlite
  let db: Database

  beforeAll(async () => {
    client = new PGlite()
    const logged = drizzle({ client, schema, logger: { logQuery: (query) => queries.push(query) } })
    await migrate(logged, { migrationsFolder: defaultMigrationsFolder() })
    db = logged as unknown as Database
  })
  afterAll(() => client.close())

  async function scope() {
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Locked', slug: `locked-${randomUUID()}`, plan: 'free' })
      .returning()
    const ctx = {
      db,
      jobs: memoryJobs(),
      storage: memoryStorage(),
      now: () => new Date(),
      log: consoleLog,
    }
    return usageScope(ctx, toOrganizationId(org!.id))
  }

  async function firstQueryOf(work: () => Promise<unknown>): Promise<string> {
    queries.length = 0
    await work()
    return queries[0]!
  }

  const locksOrganizationRow = (query: string) => {
    expect(query).toMatch(/from "organizations"/)
    expect(query).toMatch(/for no key update\s*$/)
  }

  it('locks the organization row only to write a missing grant before reading balances', async () => {
    const usage = await scope()
    queries.length = 0
    await usage.summary()
    expect(queries.some((q) => /for no key update\s*$/.test(q))).toBe(true)
    queries.length = 0
    await usage.summary()
    await usage.check('credits', 1)
    expect(queries.some((q) => /for no key update/.test(q))).toBe(false)
  })

  it('locks the organization row before spending or setting a level', async () => {
    const usage = await scope()
    locksOrganizationRow(
      await firstQueryOf(() => usage.consume('credits', 1, { idempotencyKey: 'sql-1' })),
    )
    locksOrganizationRow(await firstQueryOf(() => usage.set('storage_gb', 1)))
  })

  it('locks the organization row before capping a payment reversal', async () => {
    const usage = await scope()
    await usage.credit(1_000, { idempotencyKey: 'checkout:sql' })
    locksOrganizationRow(
      await firstQueryOf(() =>
        usage.reverse(100, { idempotencyKey: 're', payment: { key: 'pi', cents: 1_000 } }),
      ),
    )
  })

  it('writes the monthly grant with on conflict do nothing', async () => {
    const usage = await scope()
    queries.length = 0
    await usage.summary()
    const grant = queries.find((q) => q.startsWith('insert into "credit_ledger"'))
    expect(grant).toMatch(/on conflict do nothing/)
  })
})

const postgresUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL

describe.skipIf(!postgresUrl)('usage under real Postgres concurrency', () => {
  let data: Data

  beforeAll(async () => {
    data = await openData(
      { databaseUrl: postgresUrl },
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
    return { id: org!.id, usage: data.forOrganization(org!.id).usage }
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

  it('writes the monthly grant once under concurrent first reads', async () => {
    const { id, usage } = await newOrganization()
    try {
      await Promise.all(Array.from({ length: 10 }, () => usage.summary()))
      const rows = await data.db
        .select()
        .from(creditLedger)
        .where(eq(creditLedger.organizationId, id))
      expect(rows.filter((r) => r.reason === 'plan_grant' && r.metric === 'credits')).toHaveLength(
        1,
      )
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
