import { afterEach, describe, expect, it, vi } from 'vitest'

import { reloadOnStaleChunk, type StaleChunkWindow } from './stale-chunk'

const CHUNK = 'https://app.example.com/assets/chunk-HSAYDWCY.js'

function setUp(sessionStorage?: Pick<Storage, 'getItem' | 'setItem'>) {
  const store = new Map<string, string>()
  const reload = vi.fn()
  const win = {
    sessionStorage: sessionStorage ?? {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    location: { reload },
  } as unknown as StaleChunkWindow
  return { win, reload }
}

const failed = (message: string) => new TypeError(message)

describe('reloadOnStaleChunk', () => {
  afterEach(() => vi.useRealTimers())

  it.each([
    `Failed to fetch dynamically imported module: ${CHUNK}`,
    `error loading dynamically imported module: ${CHUNK}`,
    'Importing a module script failed.',
  ])('reloads the page on %s', (message) => {
    const { win, reload } = setUp()
    expect(reloadOnStaleChunk(failed(message), win)).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads once per 10 seconds: a chunk that fails again right after is left to fail', () => {
    vi.useFakeTimers()
    const { win, reload } = setUp()
    const error = failed(`Failed to fetch dynamically imported module: ${CHUNK}`)
    expect(reloadOnStaleChunk(error, win)).toBe(true)
    vi.advanceTimersByTime(5_000)
    expect(reloadOnStaleChunk(error, win)).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(reloadOnStaleChunk(error, win)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('leaves any other error alone', () => {
    const { win, reload } = setUp()
    expect(reloadOnStaleChunk(failed('Cannot match any routes'), win)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('never reloads when sessionStorage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      setItem: () => undefined,
    }
    const { win, reload } = setUp(blocked)
    expect(reloadOnStaleChunk(failed('Importing a module script failed.'), win)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
