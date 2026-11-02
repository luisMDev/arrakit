import { WORKER_RETRY_POLICY } from '@arrakit/db'
import { type TestData, openTestData } from '@arrakit/db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { recordingErrorReporter } from '../observability/error-reporter'
import { type LogEntry, recordingLogger } from '../observability/logger'

import { JOBS } from '.'
import { defineJob, registerJobs, sendJob } from './job'

describe('typed jobs', () => {
  let data: TestData
  const { log, logs } = recordingLogger()
  const { errors, captured } = recordingErrorReporter()
  const errorLogs = () => logs.filter((entry: LogEntry) => entry.level === 'error')
  const handled: { count: number }[] = []
  let failNext: Error | null = null

  const greet = defineJob({
    name: 'greet',
    schema: z.object({ count: z.coerce.number().int().positive() }),
    policy: { ...WORKER_RETRY_POLICY, exclusivity: 'exclusive' },
    async handler(payload) {
      if (failNext) {
        const err = failNext
        failNext = null
        throw err
      }
      handled.push(payload)
    },
    schedule: { cron: '0 3 * * *', data: { count: '1' }, tz: 'Europe/Madrid' },
    logFields: ({ count }) => ({ count }),
  })
  const quiet = defineJob({
    name: 'quiet',
    schema: z.object({}),
    policy: WORKER_RETRY_POLICY,
    handler: async () => {},
  })

  beforeAll(async () => {
    data = await openTestData()
    await data.jobs.schedule('quiet', '* * * * *', {})
    await registerJobs([greet, quiet], { data, log, errors })
  })
  beforeEach(() => {
    logs.splice(0)
    captured.splice(0)
    handled.splice(0)
    data.jobs.sent.splice(0)
  })
  afterAll(() => data.close())

  it('defines each queue with its policy and starts its worker', () => {
    expect(data.jobs.queues.get('greet')).toMatchObject({
      ...WORKER_RETRY_POLICY,
      exclusivity: 'exclusive',
    })
    expect([...data.jobs.workers.keys()]).toEqual(['greet', 'quiet'])
  })

  it('schedules the validated payload, and removes the schedule of a job without one', () => {
    expect(data.jobs.schedules.get('greet')).toEqual({
      cron: '0 3 * * *',
      data: { count: 1 },
      options: { tz: 'Europe/Madrid' },
    })
    expect(data.jobs.schedules.has('quiet')).toBe(false)
  })

  it('sends the parsed payload with its options, and refuses an invalid one', async () => {
    const startAfter = new Date('2026-12-01T00:00:00Z')
    const options = { startAfter, priority: 3, singletonKey: 'a' }
    const id = await sendJob(data.jobs, greet, { count: '2' }, options)
    expect(id).toEqual(expect.any(String))
    expect(data.jobs.sent).toEqual([{ id, name: 'greet', data: { count: 2 }, options }])

    await expect(sendJob(data.jobs, greet, { count: -1 })).rejects.toBeInstanceOf(z.ZodError)
    expect(data.jobs.sent).toHaveLength(1)
  })

  it('hands the handler the parsed payload', async () => {
    await data.jobs.send('greet', { count: '4' })
    await data.jobs.run('greet')
    expect(handled).toEqual([{ count: 4 }])
  })

  it('dead-letters an invalid payload without running the handler or rethrowing', async () => {
    const worker = data.jobs.workers.get('greet')!
    await expect(worker({ count: 'many' })).resolves.toBeUndefined()

    expect(handled).toEqual([])
    expect(data.jobs.sent).toEqual([
      expect.objectContaining({ name: 'greet__dead', data: { count: 'many' } }),
    ])
    expect(errorLogs()).toEqual([
      expect.objectContaining({
        msg: 'job payload invalid; dead-lettered without retries',
        job: 'greet',
      }),
    ])
    expect(captured).toEqual([])
  })

  it('logs, reports and rethrows a failing handler so the queue retries it', async () => {
    failNext = new Error('boom')
    const worker = data.jobs.workers.get('greet')!
    await expect(worker({ count: 5 })).rejects.toThrow('boom')

    expect(errorLogs()).toEqual([
      expect.objectContaining({
        msg: 'job failed; the queue retries it, then dead-letters it',
        job: 'greet',
        count: 5,
        err: expect.objectContaining({ message: 'boom' }),
      }),
    ])
    expect(captured).toEqual([{ error: expect.any(Error), tags: { job: 'greet' } }])
  })

  it('registers every job of the API under a unique name', () => {
    const names = JOBS.map((job) => job.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('storage-purge')
  })
})
