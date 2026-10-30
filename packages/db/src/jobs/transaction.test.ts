import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { fromPglite } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '../connection'
import { type Data, openData } from '../open-data'
import { consoleLog } from '../log'
import { memoryStorage } from '../storage/memory'
import { type TestData, openTestData } from '../testing'
import { inProcessJobs } from './in-process'
import { pgBossJobs } from './pg-boss'
import { jobConnectionOf, transactionWithJobs } from './transaction'
import type { JobsRuntime, TransactionWithJobs } from './types'

class Rollback extends Error {}

const rowsIn = async (db: Database, table: string) => {
  const result = (await db.execute(sql.raw(`select x from ${table} order by x`))) as unknown as {
    rows: { x: number }[]
  }
  return result.rows.map((row) => row.x)
}

/** The behaviour every runner shares: rows and jobs commit together, or neither does. */
function commitsTogether(
  name: string,
  open: () => Promise<{ db: Database; jobs: JobsRuntime; withJobs: TransactionWithJobs }>,
  close: () => Promise<void>,
) {
  describe(`transactionWithJobs on ${name}`, () => {
    let db: Database
    let jobs: JobsRuntime
    let withJobs: TransactionWithJobs
    const queue = `tx-${name.replace(/\W+/g, '-').toLowerCase()}`

    beforeAll(async () => {
      ;({ db, jobs, withJobs } = await open())
      await db.execute(sql.raw(`create table if not exists ${queue.replace(/-/g, '_')} (x int)`))
      await jobs.defineQueue(queue, { retryLimit: 0, retryDelay: 0, retryBackoff: false })
    })
    afterAll(close)

    const table = () => queue.replace(/-/g, '_')

    it('commits the rows and the job together, under the id send returned', async () => {
      const id = await withJobs(async (tx, send) => {
        await tx.execute(sql.raw(`insert into ${table()} (x) values (1)`))
        return send(queue, { n: 1 })
      })
      expect(await rowsIn(db, table())).toContain(1)
      const found = await jobs.find(queue, { id })
      expect(found).toHaveLength(1)
      expect(found[0]!.data).toEqual({ n: 1 })
    })

    it('keeps neither the rows nor the job when the work throws', async () => {
      let id: string | undefined
      await expect(
        withJobs(async (tx, send) => {
          await tx.execute(sql.raw(`insert into ${table()} (x) values (2)`))
          id = await send(queue, { n: 2 })
          throw new Rollback('nothing commits')
        }),
      ).rejects.toBeInstanceOf(Rollback)
      expect(id).toBeDefined()
      expect(await rowsIn(db, table())).not.toContain(2)
      expect(await jobs.find(queue, { id: id! })).toEqual([])
      expect((await jobs.find(queue)).map((job) => job.data)).not.toContainEqual({ n: 2 })
    })

    it('answers what work returns', async () => {
      expect(await withJobs(async () => 'done')).toBe('done')
    })
  })
}

describe('memory runner (openTestData)', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  it('holds a job sent in a transaction until the transaction commits', async () => {
    const seenInside: number[] = []
    const id = await data.transactionWithJobs(async (_tx, send) => {
      const sent = await send('held', { n: 1 })
      seenInside.push(data.jobs.sent.length)
      return sent
    })
    expect(seenInside).toEqual([0])
    expect(data.jobs.sent).toEqual([expect.objectContaining({ id, name: 'held', data: { n: 1 } })])
  })

  it('drops a job sent in a transaction that rolls back', async () => {
    const before = data.jobs.sent.length
    await expect(
      data.transactionWithJobs(async (_tx, send) => {
        await send('dropped', { n: 2 })
        throw new Rollback()
      }),
    ).rejects.toBeInstanceOf(Rollback)
    expect(data.jobs.sent).toHaveLength(before)
  })
})

{
  let data: Data
  commitsTogether(
    'the in-process runner (openData on PGlite)',
    async () => {
      data = await openData(
        { pgliteDir: 'memory://' },
        { storage: memoryStorage(), jobs: inProcessJobs({ log: consoleLog }) },
      )
      return { db: data.db, jobs: data.jobs, withJobs: data.transactionWithJobs }
    },
    () => data.close(),
  )
}

{
  let pg: PGlite
  let jobs: JobsRuntime
  commitsTogether(
    'pg-boss (pglite backend)',
    async () => {
      pg = await PGlite.create()
      jobs = await pgBossJobs({ db: fromPglite(pg), backend: 'pglite' }, consoleLog)
      const db = drizzle({ client: pg }) as unknown as Database
      return { db, jobs, withJobs: transactionWithJobs(db, jobs) }
    },
    async () => {
      await jobs.stop()
      if (!pg.closed) await pg.close()
    },
  )
}

/**
 * Real Postgres through node-postgres and the pg-boss pool: runs only when DATABASE_URL is set
 * (a CI Postgres service); there is no Postgres on machines without Docker.
 */
describe.runIf(Boolean(process.env.DATABASE_URL))('on Postgres (DATABASE_URL)', () => {
  let data: Data
  commitsTogether(
    'pg-boss (Postgres)',
    async () => {
      data = await openData(
        { databaseUrl: process.env.DATABASE_URL! },
        { storage: memoryStorage() },
      )
      expect(data.jobs.kind).toBe('pg-boss')
      return { db: data.db, jobs: data.jobs, withJobs: data.transactionWithJobs }
    },
    () => data.close(),
  )
})

describe('jobConnectionOf', () => {
  it('refuses a transaction whose client it cannot reach', () => {
    expect(() => jobConnectionOf({} as never)).toThrow(/cannot reach the client/)
  })
})
