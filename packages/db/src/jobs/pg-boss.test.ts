import { randomUUID } from 'node:crypto'

import { PGlite } from '@electric-sql/pglite'
import { fromPglite } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { pgBossJobs } from './pg-boss'
import { type JobsRuntime, deadLetterOf } from './types'

/**
 * The real pg-boss runtime (packages/db/src/jobs/pg-boss.ts), not a fake. It always runs on PGlite
 * through pg-boss's own `pglite` backend, and again on real Postgres when DATABASE_URL is set
 * (CI with a Postgres service). PGlite is a single connection, so row-lock waits between
 * connections are only exercised on the DATABASE_URL run.
 */
interface Target {
  name: string
  open(): Promise<{ jobs: JobsRuntime; sql(text: string, values?: unknown[]): Promise<unknown[]> }>
}

const pgliteTarget: Target = {
  name: 'PGlite (pg-boss pglite backend)',
  async open() {
    const pg = await PGlite.create()
    const jobs = await pgBossJobs({ db: fromPglite(pg), backend: 'pglite' })
    const stop = jobs.stop.bind(jobs)
    return {
      jobs: Object.assign(jobs, {
        stop: async () => {
          await stop()
          if (!pg.closed) await pg.close()
        },
      }),
      sql: async (text, values) => (await pg.query(text, values)).rows,
    }
  },
}

const postgresTarget: Target = {
  name: 'Postgres (DATABASE_URL)',
  async open() {
    const url = process.env.DATABASE_URL!
    const { default: pg } = await import('pg')
    const pool = new pg.Pool({ connectionString: url, max: 1 })
    const jobs = await pgBossJobs(url)
    const stop = jobs.stop.bind(jobs)
    return {
      jobs: Object.assign(jobs, {
        stop: async () => {
          await stop()
          if (!pool.ended) await pool.end()
        },
      }),
      sql: async (text, values) => (await pool.query(text, values)).rows,
    }
  },
}

const targets = [pgliteTarget, ...(process.env.DATABASE_URL ? [postgresTarget] : [])]

const queueName = () => `q_${randomUUID().replaceAll('-', '')}`

const waitFor = async (check: () => Promise<boolean>, timeoutMs = 20_000) => {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

describe.each(targets)('pgBossJobs on $name', (target) => {
  let jobs: JobsRuntime
  let sql: (text: string, values?: unknown[]) => Promise<unknown[]>

  beforeAll(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ;({ jobs, sql } = await target.open())
  }, 60_000)
  afterAll(async () => {
    await jobs.stop()
    vi.restoreAllMocks()
  })

  it('is the pg-boss runtime and its probe passes while it runs', async () => {
    expect(jobs.kind).toBe('pg-boss')
    await expect(jobs.probe()).resolves.toBeUndefined()
  })

  it('retries a failing job, then dead-letters its payload', async () => {
    const queue = queueName()
    await jobs.defineQueue(queue, { retryLimit: 1, retryDelay: 1, retryBackoff: false })
    let attempts = 0
    await jobs.work(
      queue,
      async () => {
        attempts += 1
        throw new Error('boom')
      },
      { pollingIntervalSeconds: 0.5 },
    )
    const id = await jobs.send(queue, { n: 1 })
    await waitFor(async () => (await jobs.find(queue, { id }))[0]?.state === 'failed')
    expect(attempts).toBe(2)
    await waitFor(async () => (await jobs.find(deadLetterOf(queue))).length > 0)
    expect((await jobs.find(deadLetterOf(queue))).map((job) => job.data)).toEqual([{ n: 1 }])
  }, 30_000)

  it('completes a job that fails once and then succeeds, and dead-letters nothing', async () => {
    const queue = queueName()
    await jobs.defineQueue(queue, { retryLimit: 2, retryDelay: 1, retryBackoff: true })
    let attempts = 0
    await jobs.work(
      queue,
      async () => {
        attempts += 1
        if (attempts === 1) throw new Error('once')
      },
      { pollingIntervalSeconds: 0.5 },
    )
    const id = await jobs.send(queue, { n: 2 })
    await waitFor(async () => (await jobs.find(queue, { id }))[0]?.state === 'completed')
    expect(attempts).toBe(2)
    expect(await jobs.find(deadLetterOf(queue))).toEqual([])
  }, 30_000)

  it('holds a job sent with startAfter until then', async () => {
    const queue = queueName()
    await jobs.defineQueue(queue, { retryLimit: 0, retryDelay: 1, retryBackoff: false })
    const seen: object[] = []
    await jobs.work(queue, async (data) => void seen.push(data), { pollingIntervalSeconds: 0.5 })
    await jobs.send(queue, { later: true }, { startAfter: new Date(Date.now() + 60 * 60_000) })
    const now = await jobs.send(queue, { later: false })
    await waitFor(async () => (await jobs.find(queue, { id: now }))[0]?.state === 'completed')
    expect(seen).toEqual([{ later: false }])
    const held = (await jobs.find(queue)).find((job) => (job.data as { later: boolean }).later)
    expect(held?.state).toBe('created')
  }, 30_000)

  it('queues one job per key on an exclusive queue while it waits', async () => {
    const queue = queueName()
    await jobs.defineQueue(
      queue,
      { retryLimit: 0, retryDelay: 1, retryBackoff: false },
      { exclusive: true },
    )
    expect(await jobs.sendOnce(queue, { org: 'a' }, 'a')).toBe(true)
    expect(await jobs.sendOnce(queue, { org: 'a' }, 'a')).toBe(false)
    expect(await jobs.sendOnce(queue, { org: 'b' }, 'b')).toBe(true)
    await jobs.work(queue, async () => {}, { pollingIntervalSeconds: 0.5 })
    await waitFor(async () => (await jobs.find(queue)).every((job) => job.state === 'completed'))
    expect(await jobs.sendOnce(queue, { org: 'a' }, 'a')).toBe(true)
  }, 30_000)

  it('refuses to define as exclusive a queue that exists with another policy', async () => {
    const queue = queueName()
    await jobs.defineQueue(queue, { retryLimit: 0, retryDelay: 1, retryBackoff: false })
    await expect(
      jobs.defineQueue(
        queue,
        { retryLimit: 0, retryDelay: 1, retryBackoff: false },
        { exclusive: true },
      ),
    ).rejects.toThrow(`[data] queue ${queue} exists with policy standard, not exclusive`)
  })

  it('keeps the policy a queue was created with when it is defined again', async () => {
    const queue = queueName()
    await jobs.defineQueue(queue, {
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 120,
    })
    await jobs.defineQueue(queue, { retryLimit: 1, retryDelay: 2, retryBackoff: false })
    expect(await jobs.queuePolicy(queue)).toEqual({
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 120,
    })
  })

  it('gives a queue defined with no expiry 900 s, and no policy for an unknown queue', async () => {
    const queue = queueName()
    await jobs.defineQueue(queue, { retryLimit: 5, retryDelay: 30, retryBackoff: true })
    expect((await jobs.queuePolicy(queue))?.expireInSeconds).toBe(900)
    expect(await jobs.queuePolicy(queueName())).toBeUndefined()
  })

  it('schedules a queue on a cron in UTC, catching up one missed tick, replacing the schedule', async () => {
    const queue = queueName()
    await jobs.defineQueue(queue, { retryLimit: 0, retryDelay: 1, retryBackoff: false })
    await jobs.schedule(queue, '0 3 1 * *', { month: 'previous' })
    await jobs.schedule(queue, '0 2 1 * *', { month: 'previous' })
    const rows = (await sql('SELECT * FROM pgboss.schedule WHERE name = $1', [queue])) as {
      cron: string
      timezone: string
      data: object
      options: object
    }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      cron: '0 2 1 * *',
      timezone: 'UTC',
      data: { month: 'previous' },
      options: { tz: 'UTC', missed: 'once' },
    })
  })

  it('fails the probe once stopped, and stop is idempotent', async () => {
    const other = await target.open()
    await other.jobs.stop()
    await other.jobs.stop()
    await expect(other.jobs.probe()).rejects.toThrow('[data] pg-boss is stopped')
  }, 60_000)
})
