import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  onPreloadError,
  type PreloadErrorEvent,
  recoverFromStaleChunk,
  type StaleChunkWindow,
} from './stale-chunk'

const CHUNK = 'https://app.example.com/assets/chunk-HSAYDWCY.js'

function setUp(sessionStorage?: Pick<Storage, 'getItem' | 'setItem'>) {
  const store = new Map<string, string>()
  const assign = vi.fn()
  const fetch = vi.fn().mockResolvedValue(new Response(''))
  const win = {
    sessionStorage: sessionStorage ?? {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    fetch,
    location: { assign },
    document: { baseURI: 'https://app.example.com/' },
  } as unknown as StaleChunkWindow
  return { win, fetch, assign }
}

const failed = (message: string) => new TypeError(message)

describe('recoverFromStaleChunk', () => {
  afterEach(() => vi.useRealTimers())

  it('fetches the chunk past the cache, then loads the screen from scratch', async () => {
    const { win, fetch, assign } = setUp()
    const recovered = await recoverFromStaleChunk(
      failed(`Failed to fetch dynamically imported module: ${CHUNK}`),
      '/start',
      win,
    )
    expect(recovered).toBe(true)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(CHUNK, { cache: 'reload' })
    expect(assign).toHaveBeenCalledExactlyOnceWith('https://app.example.com/start')
    expect(fetch.mock.invocationCallOrder[0]).toBeLessThan(assign.mock.invocationCallOrder[0]!)
  })

  it("loads the screen from scratch on Safari's message, which names no chunk", async () => {
    const { win, fetch, assign } = setUp()
    expect(
      await recoverFromStaleChunk(failed('Importing a module script failed.'), '/start', win),
    ).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    expect(assign).toHaveBeenCalledExactlyOnceWith('https://app.example.com/start')
  })

  it('still loads the screen when the chunk cannot be fetched', async () => {
    const { win, fetch, assign } = setUp()
    fetch.mockRejectedValueOnce(new TypeError('offline'))
    await recoverFromStaleChunk(
      failed(`error loading dynamically imported module: ${CHUNK}`),
      '/start',
      win,
    )
    expect(assign).toHaveBeenCalledOnce()
  })

  it('tries once: a chunk that fails again right after is left to fail', async () => {
    vi.useFakeTimers()
    const { win, assign } = setUp()
    const error = failed(`Failed to fetch dynamically imported module: ${CHUNK}`)
    expect(await recoverFromStaleChunk(error, '/start', win)).toBe(true)
    vi.advanceTimersByTime(5_000)
    expect(await recoverFromStaleChunk(error, '/start', win)).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(await recoverFromStaleChunk(error, '/start', win)).toBe(true)
    expect(assign).toHaveBeenCalledTimes(2)
  })

  it('leaves any other error alone', async () => {
    const { win, fetch, assign } = setUp()
    expect(await recoverFromStaleChunk(failed('Cannot match any routes'), '/start', win)).toBe(
      false,
    )
    expect(await recoverFromStaleChunk('not an error', '/start', win)).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  it('does nothing without session storage, which guards against a reload loop', async () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError')
    }
    const { win, assign } = setUp({ getItem: blocked, setItem: blocked })
    expect(
      await recoverFromStaleChunk(
        failed(`Failed to fetch dynamically imported module: ${CHUNK}`),
        '/start',
        win,
      ),
    ).toBe(false)
    expect(assign).not.toHaveBeenCalled()
  })
})

function preloadError(payload: unknown): PreloadErrorEvent {
  return Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload })
}

describe('onPreloadError', () => {
  it("cancels Vite's rethrow and reloads the target once the chunk was fetched again", async () => {
    const { win, fetch, assign } = setUp()
    const event = preloadError(failed(`Failed to fetch dynamically imported module: ${CHUNK}`))
    expect(onPreloadError(event, '/app/settings', win)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledExactlyOnceWith('https://app.example.com/app/settings'),
    )
    expect(fetch).toHaveBeenCalledExactlyOnceWith(CHUNK, { cache: 'reload' })
  })

  it('lets Vite rethrow anything else, and a chunk that fails again right after', () => {
    const { win, assign } = setUp()
    const other = preloadError(new Error('Unable to preload CSS for /assets/a.css'))
    expect(onPreloadError(other, '/app', win)).toBe(false)
    expect(other.defaultPrevented).toBe(false)

    const stale = failed('Importing a module script failed.')
    expect(onPreloadError(preloadError(stale), '/app', win)).toBe(true)
    const again = preloadError(stale)
    expect(onPreloadError(again, '/app', win)).toBe(false)
    expect(again.defaultPrevented).toBe(false)
    expect(assign).toHaveBeenCalledOnce()
  })

  it('shares the loop guard with the router error screen', async () => {
    const { win } = setUp()
    const stale = failed('Importing a module script failed.')
    expect(onPreloadError(preloadError(stale), '/app', win)).toBe(true)
    expect(await recoverFromStaleChunk(stale, '/app', win)).toBe(false)
  })
})
