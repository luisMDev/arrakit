import { afterEach, describe, expect, it, vi } from 'vitest'

import { EmailRefusedError, PROVIDERS_UNKNOWN, createHttpAuthApi, refusedLanding } from './auth-api'

const ORIGIN = window.location.origin

function stubFetch(answer: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return answer(url, init)
    }),
  )
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('refusedLanding', () => {
  it.each([
    ['/profile', undefined, '/signup'],
    ['/profile', 'google', '/signup?via=google'],
    ['/profile?plan=pro&cycle=yearly', undefined, '/signup?plan=pro&cycle=yearly'],
    ['/profile?plan=pro&cycle=yearly', 'microsoft', '/signup?plan=pro&cycle=yearly&via=microsoft'],
    ['/signin', undefined, '/signin'],
    ['/signin', 'google', '/signin?via=google'],
    [
      '/api/auth/oauth2/authorize?client_id=claude',
      'microsoft',
      '/oauth/signin?client_id=claude&via=microsoft',
    ],
  ] as const)('(%s, %s) → %s', (landing, via, refused) =>
    expect(refusedLanding(landing, via)).toBe(refused),
  )
})

describe('createHttpAuthApi', () => {
  it('posts the magic link with absolute callback URLs', async () => {
    const calls = stubFetch(() => Response.json({ status: true }))
    await createHttpAuthApi().sendMagicLink('ana@acme.com', '/profile?plan=team&cycle=monthly')
    expect(calls[0]).toEqual({
      url: '/api/auth/sign-in/magic-link',
      body: {
        email: 'ana@acme.com',
        callbackURL: `${ORIGIN}/profile?plan=team&cycle=monthly`,
        errorCallbackURL: `${ORIGIN}/signup?plan=team&cycle=monthly`,
      },
    })
  })

  it('turns a 400 into EmailRefusedError and keeps a 500 apart', async () => {
    stubFetch(() => new Response('{}', { status: 400 }))
    await expect(createHttpAuthApi().sendMagicLink('x@y.co', '/profile')).rejects.toBeInstanceOf(
      EmailRefusedError,
    )
    stubFetch(() => new Response('{}', { status: 500 }))
    const err = await createHttpAuthApi()
      .sendMagicLink('x@y.co', '/profile')
      .catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(EmailRefusedError)
    expect(err).toMatchObject({ status: 500 })
  })

  it('rejects on a network error', async () => {
    stubFetch(() => Promise.reject(new TypeError('offline')))
    await expect(createHttpAuthApi().sendMagicLink('x@y.co', '/profile')).rejects.toThrow('offline')
  })

  it('redirects to the provider only after it answers, with the via param', async () => {
    const redirect = vi.fn()
    const calls = stubFetch(() => Response.json({ url: 'https://accounts.google.com/x' }))
    await createHttpAuthApi({ redirect }).signInWith('google', '/api/auth/oauth2/authorize?a=1')
    expect(calls[0]?.body).toEqual({
      provider: 'google',
      callbackURL: `${ORIGIN}/api/auth/oauth2/authorize?a=1`,
      errorCallbackURL: `${ORIGIN}/oauth/signin?a=1&via=google`,
    })
    expect(redirect).toHaveBeenCalledWith('https://accounts.google.com/x')
  })

  it('does not redirect when the start fails', async () => {
    const redirect = vi.fn()
    stubFetch(() => new Response('{}', { status: 404 }))
    await expect(
      createHttpAuthApi({ redirect }).signInWith('microsoft', '/signin'),
    ).rejects.toMatchObject({ status: 404 })
    expect(redirect).not.toHaveBeenCalled()
  })

  it('asks for the providers once, falls back on failure and retries next time', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ google: false, microsoft: true })
    const api = createHttpAuthApi({ loadProviders: load })
    expect(await api.providers()).toEqual(PROVIDERS_UNKNOWN)
    expect(await api.providers()).toEqual({ google: false, microsoft: true })
    expect(await api.providers()).toEqual({ google: false, microsoft: true })
    expect(load).toHaveBeenCalledTimes(2)
  })
})
