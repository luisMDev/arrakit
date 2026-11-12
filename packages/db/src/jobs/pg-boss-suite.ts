import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { type JobAttempt, type JobsRuntime, WORKER_RETRY_POLICY, deadLetterOf } from './types'

/** A database the real pg-boss runtime (./pg-boss.ts) runs on, with raw SQL to inspect it. */
export interface JobsTarget {
  name: string
  open(): Promise<{ jobs: JobsRuntime; sql(text: string, values?: unknown[]): Promise<unknown[]> }>
}

const queueName = () => `q_${randomUUID().replaceAll('-', '')}`

const waitFor = async (check: () => Promise<boolean>, timeoutMs = 20_000) => {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

export function describeJobs(target: JobsTarget) {
  describe(`pgBossJobs on ${target.name}`, () => {
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

    it('passes its probe while it runs', async () => {
      await expect(jobs.probe()).resolves.toBeUndefined()
    })

    const jobsOn = async (queue: string) =>
      (await sql('SELECT id, state, data FROM pgboss.job WHERE name = $1', [queue])) as {
        id: string
        state: string
        data: object
      }[]
    const stateOf = async (queue: string, id: string | null) =>
      (await jobsOn(queue)).find((job) => job.id === id)?.state

    it('retries a failing job, then dead-letters its payload', async () => {
      const queue = queueName()
      await jobs.defineQueue(queue, { retryLimit: 1, retryDelay: 1, retryBackoff: false })
      let attempts = 0
      await jobs.work(queue, async () => {
        attempts += 1
        throw new Error('boom')
      })
      const id = await jobs.send(queue, { n: 1 })
      await waitFor(async () => (await stateOf(queue, id)) === 'failed')
      expect(attempts).toBe(2)
      await waitFor(async () => (await jobsOn(deadLetterOf(queue))).length > 0)
      expect((await jobsOn(deadLetterOf(queue))).map((job) => job.data)).toEqual([{ n: 1 }])
    }, 30_000)

    it('hands the worker the attempt it runs: id, retry count and limit, and an abort signal', async () => {
      const queue = queueName()
      await jobs.defineQueue(queue, { retryLimit: 1, retryDelay: 1, retryBackoff: false })
      const attempts: JobAttempt[] = []
      await jobs.work(queue, async (_data, attempt) => {
        attempts.push(attempt)
        if (attempts.length === 1) throw new Error('once')
      })
      const id = await jobs.send(queue, { n: 10 })
      await waitFor(async () => (await stateOf(queue, id)) === 'completed')

      expect(
        attempts.map(({ id, retryCount, retryLimit }) => ({ id, retryCount, retryLimit })),
      ).toEqual([
        { id, retryCount: 0, retryLimit: 1 },
        { id, retryCount: 1, retryLimit: 1 },
      ])
      expect(attempts.every((attempt) => attempt.signal instanceof AbortSignal)).toBe(true)
    }, 30_000)

    it('completes a job that fails once and then succeeds, and dead-letters nothing', async () => {
      const queue = queueName()
      await jobs.defineQueue(queue, { retryLimit: 2, retryDelay: 1, retryBackoff: true })
      let attempts = 0
      await jobs.work(queue, async () => {
        attempts += 1
        if (attempts === 1) throw new Error('once')
      })
      const id = await jobs.send(queue, { n: 2 })
      await waitFor(async () => (await stateOf(queue, id)) === 'completed')
      expect(attempts).toBe(2)
      expect(await jobsOn(deadLetterOf(queue))).toEqual([])
    }, 30_000)

    it('keeps the policy a queue was created with when it is defined again', async () => {
      const queue = queueName()
      await jobs.defineQueue(queue, {
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 120,
      })
      await jobs.defineQueue(queue, { retryLimit: 1, retryDelay: 2, retryBackoff: false })
      const [row] = (await sql(
        'SELECT retry_limit, retry_delay, retry_backoff, expire_seconds, dead_letter FROM pgboss.queue WHERE name = $1',
        [queue],
      )) as Record<string, unknown>[]
      expect(row).toEqual({
        retry_limit: 5,
        retry_delay: 30,
        retry_backoff: true,
        expire_seconds: 120,
        dead_letter: deadLetterOf(queue),
      })
    })

    it('stores startAfter, priority and singletonKey with the job', async () => {
      const queue = queueName()
      await jobs.defineQueue(queue, WORKER_RETRY_POLICY)
      const startAfter = new Date(Date.now() + 3_600_000)
      const id = await jobs.send(queue, { n: 3 }, { startAfter, priority: 7, singletonKey: 'k1' })
      const [row] = (await sql(
        'SELECT start_after, priority, singleton_key FROM pgboss.job WHERE id = $1',
        [id],
      )) as { start_after: Date; priority: number; singleton_key: string }[]
      expect(row).toMatchObject({ priority: 7, singleton_key: 'k1' })
      expect(Math.abs(new Date(row!.start_after).getTime() - startAfter.getTime())).toBeLessThan(
        1000,
      )
    })

    it('answers null for a duplicate singletonKey on an exclusive queue', async () => {
      const queue = queueName()
      await jobs.defineQueue(queue, { ...WORKER_RETRY_POLICY, exclusivity: 'exclusive' })
      const first = await jobs.send(queue, { n: 4 }, { singletonKey: 'org-1', startAfter: 3600 })
      expect(first).toEqual(expect.any(String))
      expect(await jobs.send(queue, { n: 5 }, { singletonKey: 'org-1' })).toBeNull()
      expect(await jobs.send(queue, { n: 6 }, { singletonKey: 'org-2' })).toEqual(
        expect.any(String),
      )
      const [row] = (await sql('SELECT policy FROM pgboss.queue WHERE name = $1', [queue])) as {
        policy: string
      }[]
      expect(row?.policy).toBe('exclusive')
    })

    it('dead-letters a payload straight away', async () => {
      const queue = queueName()
      await jobs.defineQueue(queue, WORKER_RETRY_POLICY)
      await jobs.deadLetter(queue, { n: 9 })
      expect((await jobsOn(deadLetterOf(queue))).map((job) => job.data)).toEqual([{ n: 9 }])
      expect(await jobsOn(queue)).toEqual([])
    })

    it('sends a published event to every subscribed queue, and to none when nobody listens', async () => {
      const [first, second] = [queueName(), queueName()]
      const event = `event_${randomUUID()}`
      for (const queue of [first, second]) {
        await jobs.defineQueue(queue, WORKER_RETRY_POLICY)
        await jobs.subscribe(event, queue)
      }
      await jobs.publish(event, { n: 4 })
      await jobs.publish(`nobody_${randomUUID()}`, { n: 5 })
      expect((await jobsOn(first)).map((job) => job.data)).toEqual([{ n: 4 }])
      expect((await jobsOn(second)).map((job) => job.data)).toEqual([{ n: 4 }])
    })

    it('schedules a queue with its cron, payload and time zone, and unschedules it', async () => {
      const queue = queueName()
      await jobs.defineQueue(queue, WORKER_RETRY_POLICY)
      await jobs.schedule(queue, '0 3 * * *', { n: 7 }, { tz: 'Europe/Madrid' })
      await jobs.schedule(queue, '0 4 * * *', { n: 8 }, { tz: 'Europe/Madrid' })
      const schedules = () =>
        sql('SELECT cron, timezone, data FROM pgboss.schedule WHERE name = $1', [queue])
      expect(await schedules()).toEqual([
        { cron: '0 4 * * *', timezone: 'Europe/Madrid', data: { n: 8 } },
      ])
      await jobs.unschedule(queue)
      expect(await schedules()).toEqual([])
    })

    it('fails the probe once stopped, and stop is idempotent', async () => {
      const other = await target.open()
      await other.jobs.stop()
      await other.jobs.stop()
      await expect(other.jobs.probe()).rejects.toThrow('[data] pg-boss is stopped')
    }, 60_000)
  })
}
