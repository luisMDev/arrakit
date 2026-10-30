import { afterEach, describe, expect, it, vi } from 'vitest'

import { inProcessJobs } from './in-process'
import { memoryJobs, sentJobs } from './memory'
import { deadLetterOf } from './types'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('inProcessJobs', () => {
  it('retries with backoff, then dead-letters the payload', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const jobs = inProcessJobs()
    await jobs.defineQueue('q', { retryLimit: 2, retryDelay: 1, retryBackoff: true })
    const attempts: number[] = []
    await jobs.work(
      'q',
      async () => {
        attempts.push(Date.now())
        throw new Error('boom')
      },
      { pollingIntervalSeconds: 0.1 },
    )
    const id = await jobs.send('q', { n: 1 })

    await settle(10_000)

    expect(attempts).toHaveLength(3)
    expect(attempts[1]! - attempts[0]!).toBeGreaterThanOrEqual(1000)
    expect(attempts[2]! - attempts[1]!).toBeGreaterThanOrEqual(2000)
    expect((await jobs.find('q', { id }))[0]?.state).toBe('failed')
    expect((await jobs.find(deadLetterOf('q'))).map((job) => job.data)).toEqual([{ n: 1 }])
    await jobs.stop()
  })

  it('completes a job that fails once and then succeeds', async () => {
    vi.useFakeTimers()
    const jobs = inProcessJobs()
    await jobs.defineQueue('q', { retryLimit: 3, retryDelay: 1, retryBackoff: false })
    let calls = 0
    await jobs.work(
      'q',
      async () => {
        calls += 1
        if (calls === 1) throw new Error('once')
      },
      { pollingIntervalSeconds: 0.1 },
    )
    const id = await jobs.send('q', {})
    await settle(3000)
    expect(calls).toBe(2)
    expect((await jobs.find('q', { id }))[0]?.state).toBe('completed')
    await jobs.stop()
  })

  it('honours startAfter', async () => {
    vi.useFakeTimers()
    const jobs = inProcessJobs()
    await jobs.defineQueue('q', { retryLimit: 0, retryDelay: 0, retryBackoff: false })
    const ran: object[] = []
    await jobs.work('q', async (data) => void ran.push(data), { pollingIntervalSeconds: 0.1 })
    await jobs.send('q', { later: true }, { startAfter: new Date(Date.now() + 5000) })
    await settle(4000)
    expect(ran).toEqual([])
    await settle(2000)
    expect(ran).toEqual([{ later: true }])
    await jobs.stop()
  })

  it('sends once per key on an exclusive queue while a job is pending', async () => {
    const jobs = inProcessJobs()
    await jobs.defineQueue(
      'x',
      { retryLimit: 0, retryDelay: 0, retryBackoff: false },
      { exclusive: true },
    )
    expect(await jobs.sendOnce('x', {}, 'org-1')).toBe(true)
    expect(await jobs.sendOnce('x', {}, 'org-1')).toBe(false)
    expect(await jobs.sendOnce('x', {}, 'org-2')).toBe(true)
    await jobs.stop()
  })

  it('refuses to make an existing standard queue exclusive', async () => {
    const jobs = inProcessJobs()
    const policy = { retryLimit: 0, retryDelay: 0, retryBackoff: false }
    await jobs.defineQueue('s', policy)
    await expect(jobs.defineQueue('s', policy, { exclusive: true })).rejects.toThrow(
      'not exclusive',
    )
    await jobs.stop()
  })

  it('reports the queue policy with a default expiry of 900 s', async () => {
    const jobs = inProcessJobs()
    await jobs.defineQueue('p', { retryLimit: 5, retryDelay: 30, retryBackoff: true })
    expect(await jobs.queuePolicy('p')).toEqual({
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 900,
    })
    expect(await jobs.queuePolicy('none')).toBeUndefined()
    await jobs.stop()
  })

  it('runs a schedule in UTC and a new schedule replaces the old one', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-30T10:00:30Z') })
    const jobs = inProcessJobs()
    const ran: object[] = []
    await jobs.work('tick', async (data) => void ran.push(data), { pollingIntervalSeconds: 1 })
    await jobs.schedule('tick', '* * * * *', { v: 1 })
    await jobs.schedule('tick', '* * * * *', { v: 2 })
    await settle(61_000)
    expect(ran).toEqual([{ v: 2 }])
    await jobs.stop()
  })

  it('waits for running handlers on stop, then refuses work and fails the probe', async () => {
    const jobs = inProcessJobs()
    let finish!: () => void
    let finished = false
    await jobs.defineQueue('slow', { retryLimit: 0, retryDelay: 0, retryBackoff: false })
    await jobs.work(
      'slow',
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            finished = true
            resolve()
          }
        }),
      { pollingIntervalSeconds: 0.005 },
    )
    await jobs.send('slow', {})
    await new Promise((resolve) => setTimeout(resolve, 50))
    const stopping = jobs.stop()
    let again = false
    const stoppingAgain = jobs.stop().then(() => {
      again = true
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(again).toBe(false)
    finish()
    await Promise.all([stopping, stoppingAgain])
    expect(finished).toBe(true)
    await expect(jobs.probe()).rejects.toThrow('stopped')
    await expect(jobs.send('slow', {})).rejects.toThrow('stopped')
    await jobs.stop()
  })
})

describe('memoryJobs', () => {
  it('records queues, sends, keys and schedules for assertions', async () => {
    const jobs = memoryJobs()
    await jobs.defineQueue(
      'm',
      { retryLimit: 1, retryDelay: 1, retryBackoff: false },
      { exclusive: true },
    )
    const since = new Date()
    await jobs.send('m', { organizationId: 'o1' })
    expect(await jobs.sendOnce('m', { organizationId: 'o2' }, 'k')).toBe(true)
    expect(await jobs.sendOnce('m', { organizationId: 'o2' }, 'k')).toBe(false)
    await jobs.schedule('m', '0 * * * *', {})
    expect(jobs.exclusive.has('m')).toBe(true)
    expect(sentJobs(jobs, { name: 'm', organizationId: 'o2', since })).toHaveLength(1)
    expect(jobs.schedules.get('m')?.cron).toBe('0 * * * *')
    const [first] = jobs.sent
    jobs.moveJob(first!.id, 'failed')
    expect((await jobs.find('m', { id: first!.id }))[0]?.state).toBe('failed')
    await jobs.probe()
    await jobs.stop()
    await expect(jobs.probe()).rejects.toThrow('stopped')
  })
})
