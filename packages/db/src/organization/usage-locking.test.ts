import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { memoryJobs } from '../jobs/memory'
import { consoleLog } from '../context'
import { toOrganizationId } from '../organization-id'
import { organizations } from '../schema/index'
import { memoryStorage } from '../storage/memory'
import { type TestDatabase, openTestDatabase } from '../test-database'
import { scopedTo, systemClaims } from './scoped'
import { usageScope } from './usage'

/**
 * PGlite has one connection, so it serializes transactions and cannot show a race. These tests
 * pin the lock in the emitted SQL; usage-locking.stack.test.ts proves it holds under real
 * concurrency on the local stack (`pnpm test:stack`).
 */
describe('usage row lock (emitted SQL)', () => {
  const queries: string[] = []
  let database: TestDatabase

  beforeAll(async () => {
    database = await openTestDatabase({ logger: { logQuery: (query) => queries.push(query) } })
  })
  afterAll(() => database.client.close())

  async function scope() {
    const [org] = await database.db
      .insert(organizations)
      .values({ name: 'Locked', slug: `locked-${randomUUID()}`, plan: 'free' })
      .returning()
    const ctx = {
      scoped: scopedTo(database.db, systemClaims(org!.id)),
      jobs: memoryJobs(),
      storage: memoryStorage(),
      now: () => new Date(),
      log: consoleLog,
    }
    return usageScope(ctx, toOrganizationId(org!.id))
  }

  /** The first query after the claims statement every scoped transaction opens with. */
  async function firstQueryOf(work: () => Promise<unknown>): Promise<string> {
    queries.length = 0
    await work()
    expect(queries[0]).toMatch(/set_config\('request\.jwt\.claims'/)
    return queries[1]!
  }

  const locksOrganizationRow = (query: string) => {
    expect(query).toMatch(/from "organizations"/)
    expect(query).toMatch(/for no key update\s*$/)
  }

  it('reads balances without a lock or a write', async () => {
    const usage = await scope()
    queries.length = 0
    await usage.summary()
    await usage.check('credits', 1)
    expect(queries.some((q) => /for no key update/.test(q))).toBe(false)
    expect(queries.some((q) => /^(insert|update|delete)/.test(q))).toBe(false)
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
})
