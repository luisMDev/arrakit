import { afterEach, describe, expect, it, vi } from 'vitest'

import { memoryStorage } from './storage/memory'
import type { Storage } from './storage/types'
import { openTestData } from './testing'

afterEach(() => {
  vi.restoreAllMocks()
})

const quietly = () => vi.spyOn(console, 'error').mockImplementation(() => {})

describe('health', () => {
  it('is ok with every probe up', async () => {
    const data = await openTestData()
    expect(await data.health()).toEqual({
      status: 'ok',
      postgres: 'up',
      storage: 'up',
      queue: 'up',
    })
    await data.close()
  })

  it('reports storage down when the bucket probe fails, and logs it', async () => {
    const log = quietly()
    const storage: Storage = {
      ...memoryStorage(),
      probe: async () => {
        throw new Error('NoSuchBucket')
      },
    }
    const data = await openTestData({ storage })
    expect(await data.health()).toEqual({
      status: 'error',
      postgres: 'up',
      storage: 'down',
      queue: 'up',
    })
    expect(log.mock.calls[0]?.[0]).toBe('[data] health: storage is down:')
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
