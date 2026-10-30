import { afterEach, describe, expect, it, vi } from 'vitest'

import { inProcessJobs } from './in-process'
import { consoleLog } from '../log'
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
    const error = vi.spyOn(consoleLog, 'error').mockImplementation(() => {})
    const jobs = inProcessJobs({ log: consoleLog, pollingIntervalSeconds: 0.1 })
    await jobs.defineQueue('q', { retryLimit: 2, retryDelay: 1, retryBackoff: true })
    const attempts: number[] = []
    await jobs.work('q', async () => {
      attempts.push(Date.now())
      throw new Error('boom')
    })
    const dead: object[] = []
    await jobs.work(deadLetterOf('q'), async (data) => void dead.push(data))
    const id = await jobs.send('q', { n: 1 })

    await settle(10_000)

    expect(attempts).toHaveLength(3)
    expect(attempts[1]! - attempts[0]!).toBeGreaterThanOrEqual(1000)
    expect(attempts[2]! - attempts[1]!).toBeGreaterThanOrEqual(2000)
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: id, queue: 'q' }),
      'job failed for good',
    )
    expect(dead).toEqual([{ n: 1 }])
    await jobs.stop()
  })

  it('completes a job that fails once and then succeeds', async () => {
    vi.useFakeTimers()
    const jobs = inProcessJobs({ log: consoleLog, pollingIntervalSeconds: 0.1 })
    await jobs.defineQueue('q', { retryLimit: 3, retryDelay: 1, retryBackoff: false })
    let calls = 0
    await jobs.work('q', async () => {
      calls += 1
      if (calls === 1) throw new Error('once')
    })
    await jobs.send('q', {})
    await settle(5000)
    expect(calls).toBe(2)
    await jobs.stop()
  })

  it('keeps the policy a queue was created with when it is defined again, like pg-boss', async () => {
    vi.useFakeTimers()
    const jobs = inProcessJobs({ log: consoleLog, pollingIntervalSeconds: 0.1 })
    await jobs.defineQueue('kept', { retryLimit: 0, retryDelay: 0, retryBackoff: false })
    await jobs.defineQueue('kept', { retryLimit: 5, retryDelay: 0, retryBackoff: false })
    vi.spyOn(consoleLog, 'error').mockImplementation(() => {})
    let calls = 0
    await jobs.work('kept', async () => {
      calls += 1
      throw new Error('boom')
    })
    await jobs.send('kept', {})
    await settle(2000)
    expect(calls).toBe(1)
    await jobs.stop()
  })

  it('waits for running handlers on stop, then refuses work and fails the probe', async () => {
    const jobs = inProcessJobs({ log: consoleLog, pollingIntervalSeconds: 0.005 })
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
  it('records queues and sends, and runs each sent job once', async () => {
    const jobs = memoryJobs()
    await jobs.defineQueue('m', { retryLimit: 1, retryDelay: 1, retryBackoff: false })
    expect(jobs.queues.get('m')?.expireInSeconds).toBe(900)
    await jobs.send('m', { organizationId: 'o1' })
    const since = new Date()
    await jobs.send('m', { organizationId: 'o2' })
    expect(sentJobs(jobs, { name: 'm', organizationId: 'o2', since })).toHaveLength(1)

    const ran: object[] = []
    await jobs.work('m', async (data) => void ran.push(data))
    await jobs.run('m')
    await jobs.run('m')
    expect(ran).toEqual([{ organizationId: 'o1' }, { organizationId: 'o2' }])

    await jobs.probe()
    await jobs.stop()
    await expect(jobs.probe()).rejects.toThrow('stopped')
  })
})
