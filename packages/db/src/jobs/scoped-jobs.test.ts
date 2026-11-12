import { randomUUID } from 'node:crypto'

import { type SQL, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type Database, transaction } from '../connection'
import { isInsufficientPrivilege } from '../errors'
import { workspaces } from '../schema/index'
import {
  type QueuedTestData,
  insertOrganization,
  memberClaims,
  openTestDataWithQueue,
  rawSql,
  scopedTo,
} from '../testing'

async function first<T>(db: Database, query: SQL): Promise<T | undefined> {
  const { rows } = (await db.execute(query)) as unknown as { rows: T[] }
  return rows[0]
}

const roleOf = async (tx: Database) =>
  (await first<{ role: string }>(tx, sql`select current_setting('role') as role`))!.role

describe('jobs sent from a scoped transaction', () => {
  let data: QueuedTestData
  let organizationId: string
  let otherOrganizationId: string
  const userId = randomUUID()

  beforeAll(async () => {
    data = await openTestDataWithQueue()
    organizationId = (await insertOrganization(data, { slug: 'scoped-jobs' })).id
    otherOrganizationId = (await insertOrganization(data, { slug: 'scoped-jobs-other' })).id
    await data.db.insert(workspaces).values([
      { organizationId, name: 'Mine' },
      { organizationId: otherOrganizationId, name: 'Theirs' },
    ])
  }, 60_000)
  afterAll(() => data.close())

  const member = () => scopedTo(data.db, memberClaims(organizationId, userId))

  let queues = 0
  async function newQueue() {
    const name = `scoped_jobs_${++queues}`
    await data.jobs.defineQueue(name, { retryLimit: 0, retryDelay: 0, retryBackoff: false })
    return name
  }

  async function queued(queue: string): Promise<number> {
    const { rows } = await rawSql(data)(
      'select count(*)::int as n from pgboss.job where name = $1',
      [queue],
    )
    return Number(rows[0]!.n)
  }

  it('keeps a job sent from a member scope only when the transaction commits', async () => {
    const queue = await newQueue()
    await member()((tx) => data.jobs.send(queue, { n: 1 }, { tx }))
    expect(await queued(queue)).toBe(1)

    await expect(
      member()(async (tx) => {
        await data.jobs.send(queue, { n: 2 }, { tx })
        throw new Error('abort')
      }),
    ).rejects.toThrow('abort')
    expect(await queued(queue)).toBe(1)
  })

  it('delivers an event published from a member scope only on commit', async () => {
    const queue = await newQueue()
    const event = `scoped_jobs.event_${queues}`
    await data.jobs.subscribe(event, queue)

    await expect(
      member()(async (tx) => {
        await data.jobs.publish(event, { n: 1 }, { tx })
        throw new Error('abort')
      }),
    ).rejects.toThrow('abort')
    expect(await queued(queue)).toBe(0)

    await member()((tx) => data.jobs.publish(event, { n: 2 }, { tx }))
    expect(await queued(queue)).toBe(1)
  })

  it('leaves the transaction under RLS right after the send', async () => {
    const queue = await newQueue()
    const seen = await member()(async (tx) => {
      await data.jobs.send(queue, { n: 1 }, { tx })
      const role = await roleOf(tx)
      const visible = await tx
        .select({ organizationId: workspaces.organizationId })
        .from(workspaces)
      const jobRead = await transaction(tx, (inner) =>
        inner.execute(sql`select count(*) from pgboss.job`),
      ).catch((err: unknown) => err)
      return { role, visible, jobRead }
    })
    expect(seen.role).toBe('authenticated')
    expect(seen.visible).toEqual([{ organizationId }])
    expect(isInsufficientPrivilege(seen.jobRead)).toBe(true)
  })

  it('leaves a privileged transaction privileged', async () => {
    const queue = await newQueue()
    const role = await transaction(data.db, async (tx) => {
      await data.jobs.send(queue, { n: 1 }, { tx })
      return roleOf(tx)
    })
    expect(role).toBe('none')
    expect(await queued(queue)).toBe(1)
  })

  it('keeps the outer transaction usable and under RLS after a send fails', async () => {
    const queue = await newQueue()
    const seen = await member()(async (tx) => {
      // A start date Postgres cannot read makes pg-boss's own insert fail inside the savepoint.
      const unreadable = '2026-13-45' as unknown as Date
      const failure = await transaction(tx, (inner) =>
        data.jobs.send(queue, { n: 1 }, { tx: inner, startAfter: unreadable }),
      ).catch((err: unknown) => err)
      const role = await roleOf(tx)
      const visible = await tx
        .select({ organizationId: workspaces.organizationId })
        .from(workspaces)
      await data.jobs.send(queue, { n: 2 }, { tx })
      return { failure, role, visible }
    })
    expect(seen.failure).toBeInstanceOf(Error)
    expect(String((seen.failure as Error).cause ?? seen.failure)).toMatch(/out of range|invalid/i)
    expect(seen.role).toBe('authenticated')
    expect(seen.visible).toEqual([{ organizationId }])
    expect(await queued(queue)).toBe(1)
  })
})
