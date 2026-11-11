import { describe, expect, it } from 'vitest'

import { memoryJobs } from './memory'
import type { JobAttempt } from './types'

describe('memoryJobs', () => {
  it('runs each job once as the attempt asked, on the queue retry limit', async () => {
    const jobs = memoryJobs()
    await jobs.defineQueue('greet', { retryLimit: 4, retryDelay: 1, retryBackoff: false })
    const attempts: JobAttempt[] = []
    await jobs.work('greet', async (_data, attempt) => {
      attempts.push(attempt)
    })
    const first = await jobs.send('greet', { n: 1 })
    await jobs.run('greet')
    const second = await jobs.send('greet', { n: 2 })
    await jobs.run('greet', { retryCount: 4 })

    expect(
      attempts.map(({ id, retryCount, retryLimit }) => ({ id, retryCount, retryLimit })),
    ).toEqual([
      { id: first, retryCount: 0, retryLimit: 4 },
      { id: second, retryCount: 4, retryLimit: 4 },
    ])
  })

  it('calls a worker directly as a first attempt', async () => {
    const jobs = memoryJobs()
    await jobs.defineQueue('greet', { retryLimit: 2, retryDelay: 1, retryBackoff: false })
    let seen: JobAttempt | undefined
    await jobs.work('greet', async (_data, attempt) => {
      seen = attempt
    })
    await jobs.workers.get('greet')!({ n: 1 })

    expect(seen).toMatchObject({ retryCount: 0, retryLimit: 2 })
    expect(seen!.signal.aborted).toBe(false)
  })
})
