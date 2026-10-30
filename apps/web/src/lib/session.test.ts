import { afterEach, describe, expect, it, vi } from 'vitest'

import { session } from './session'

afterEach(() => vi.unstubAllGlobals())

const answer = (body: unknown, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )

describe('session', () => {
  it('reads null as signed out', async () => {
    answer(null)
    expect(await session()).toBeNull()
  })

  it('defaults a missing name to an empty string', async () => {
    answer({ user: { email: 'ana@acme.com', name: null }, session: {} })
    expect(await session()).toEqual({ email: 'ana@acme.com', name: '' })
  })

  it('treats a 5xx as an error with its status', async () => {
    answer({}, 503)
    await expect(session()).rejects.toMatchObject({ status: 503 })
  })

  it('rejects on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline')
      }),
    )
    await expect(session()).rejects.toThrow('offline')
  })
})
