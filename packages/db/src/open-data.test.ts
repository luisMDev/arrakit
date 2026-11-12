import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest'

import { transaction } from './connection'
import { WORKER_RETRY_POLICY } from './jobs/types'
import { type Data, type ScopedData, health } from './open-data'
import { organizations } from './schema/index'
import { memoryStorage } from './storage/memory'
import type { Storage } from './storage/types'
import { FEED_NOT_RECEIVING, type TaskFeed } from './tasks/feed'
import {
  type TestData,
  insertMember,
  insertOrganization,
  insertUser,
  openTestData,
  openTestDataWithQueue,
} from './testing'

describe('openTestData', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  it('applies the migrations and reports healthy', async () => {
    await expect(data.health()).resolves.toEqual({
      status: 'ok',
      postgres: 'up',
      storage: 'up',
      queue: 'up',
      taskFeed: 'up',
    })
  })

  it('reads memberships fresh and scopes organizations by a normalized id', async () => {
    const org = await insertOrganization(data, { slug: 'acme', name: 'Acme' })
    const ana = await insertUser(data, 'ana@acme.com', 'Ana')
    await insertMember(data, org.id, ana, 'owner')

    const membership = await data.memberOf(ana)
    expect(membership?.organization.slug).toBe('acme')
    expect(membership?.role).toBe('owner')

    const scope = data.forOrganization(org.id.toUpperCase())
    expect((await scope.organization())?.name).toBe('Acme')
    expect(() => data.forOrganization('nope')).toThrow('[data] not an organization id')

    await data.db.delete(organizations).where(eq(organizations.id, org.id))
    expect(await data.memberOf(ana)).toBeNull()
  })
})

describe('ScopedData, the type app code is given', () => {
  it('has no raw database or bucket handle, only forOrganization()', () => {
    expectTypeOf<ScopedData>().not.toHaveProperty('db')
    expectTypeOf<ScopedData>().not.toHaveProperty('storage')
    expectTypeOf<ScopedData>().toHaveProperty('forOrganization')
  })
})

const quietly = () => vi.spyOn(console, 'error').mockImplementation(() => {})

describe('health', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is ok with every probe up', async () => {
    const data = await openTestData()
    expect(await data.health()).toEqual({
      status: 'ok',
      postgres: 'up',
      storage: 'up',
      queue: 'up',
      taskFeed: 'up',
    })
    await data.close()
  })

  it('reports storage down when the bucket probe fails, and logs it', async () => {
    const log = { info: vi.fn(), error: vi.fn() }
    const storage: Storage = {
      ...memoryStorage(),
      probe: async () => {
        throw new Error('NoSuchBucket')
      },
    }
    const data = await openTestData({ storage, log })
    expect(await data.health()).toEqual({
      status: 'error',
      postgres: 'up',
      storage: 'down',
      queue: 'up',
      taskFeed: 'up',
    })
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: 'NoSuchBucket' }), probe: 'storage' },
      'health probe down',
    )
    await data.close()
  })

  it('reports the queue down once the data layer is closed', async () => {
    quietly()
    const data = await openTestData()
    await data.close()
    await data.close()
    const report = await data.health()
    expect(report.queue).toBe('down')
    expect(report.status).toBe('error')
  })

  it('reports the task feed down, with what to fix, when notices do not reach it', async () => {
    const log = { info: vi.fn(), error: vi.fn() }
    const data = await openTestData({ log })
    const deaf: TaskFeed = {
      subscribe: async () => () => {},
      probe: async () => {
        throw new Error(FEED_NOT_RECEIVING)
      },
      close: async () => {},
    }
    const ctx = { db: data.db, jobs: data.jobs, storage: data.storage, now: () => new Date(), log }
    expect(await health(ctx, deaf)).toEqual({
      status: 'error',
      postgres: 'up',
      storage: 'up',
      queue: 'up',
      taskFeed: 'down',
    })
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: FEED_NOT_RECEIVING }), probe: 'taskFeed' },
      'health probe down',
    )
    await expect(data.taskFeed.probe()).resolves.toBeUndefined()
    await data.close()
  })

  it('gives up on a hanging probe after about three seconds', async () => {
    quietly()
    const storage: Storage = {
      ...memoryStorage(),
      probe: () => new Promise<void>(() => {}),
    }
    const data = await openTestData({ storage })
    const started = Date.now()
    const report = await data.health()
    const took = Date.now() - started
    expect(report).toMatchObject({ status: 'error', storage: 'down', postgres: 'up', queue: 'up' })
    expect(took).toBeGreaterThanOrEqual(2900)
    expect(took).toBeLessThan(4500)
    await data.close()
  }, 10_000)
})

describe('jobs on PGlite', () => {
  let data: Data

  beforeAll(async () => {
    data = await openTestDataWithQueue({ log: { info: vi.fn(), error: vi.fn() } })
  }, 60_000)
  afterAll(() => data.close())

  it('runs pg-boss on the same PGlite Drizzle uses', async () => {
    const [jobTable] = await data.db
      .execute(sql`select to_regclass('pgboss.job')::text as name`)
      .then((result) => (result as unknown as { rows: { name: string | null }[] }).rows)
    expect(jobTable?.name).toBe('pgboss.job')
    expect((await data.health()).queue).toBe('up')
  })

  it('runs a queued job while Drizzle queries the same database', async () => {
    const seen: string[] = []
    await data.jobs.defineQueue('echo', WORKER_RETRY_POLICY)
    await data.jobs.work<{ slug: string }>('echo', async ({ slug }) => {
      const [row] = await data.db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.slug, slug))
      seen.push(row?.name ?? 'missing')
    })

    await transaction(data.db, async (tx) => {
      await tx.insert(organizations).values({ slug: 'queued-co', name: 'Queued Co' })
    })
    await data.jobs.send('echo', { slug: 'queued-co' })

    await vi.waitFor(() => expect(seen).toEqual(['Queued Co']), { timeout: 20_000, interval: 100 })
  }, 30_000)
})
