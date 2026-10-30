import { afterEach, describe, expect, it, vi } from 'vitest'

import { authFetch, refusedLanding, sendMagicLink, socialSignInUrl } from './auth-api'

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

describe('auth calls', () => {
  it('posts the magic link with absolute callback URLs', async () => {
    const calls = stubFetch(() => Response.json({ status: true }))
    expect(await sendMagicLink('ana@acme.com', '/profile?plan=team&cycle=monthly')).toBe(true)
    expect(calls[0]).toEqual({
      url: '/api/auth/sign-in/magic-link',
      body: {
        email: 'ana@acme.com',
        callbackURL: `${ORIGIN}/profile?plan=team&cycle=monthly`,
        errorCallbackURL: `${ORIGIN}/signup?plan=team&cycle=monthly`,
      },
    })
  })

  it('answers false on a 400 and rejects a 500 with its status', async () => {
    stubFetch(() => new Response('{}', { status: 400 }))
    expect(await sendMagicLink('x@y.co', '/profile')).toBe(false)
    stubFetch(() => new Response('{}', { status: 500 }))
    await expect(sendMagicLink('x@y.co', '/profile')).rejects.toMatchObject({ status: 500 })
  })

  it('rejects on a network error', async () => {
    stubFetch(() => Promise.reject(new TypeError('offline')))
    await expect(sendMagicLink('x@y.co', '/profile')).rejects.toThrow('offline')
  })

  it("keeps Better Auth's message on a refusal", async () => {
    stubFetch(() => Response.json({ message: 'Sign in from the app.' }, { status: 403 }))
    await expect(authFetch('/x', {})).rejects.toMatchObject({
      status: 403,
      message: 'Sign in from the app.',
    })
  })

  it('starts a social sign-in with the via param and answers the provider URL', async () => {
    const calls = stubFetch(() => Response.json({ url: 'https://accounts.google.com/x' }))
    expect(await socialSignInUrl('google', '/api/auth/oauth2/authorize?a=1')).toBe(
      'https://accounts.google.com/x',
    )
    expect(calls[0]?.body).toEqual({
      provider: 'google',
      callbackURL: `${ORIGIN}/api/auth/oauth2/authorize?a=1`,
      errorCallbackURL: `${ORIGIN}/oauth/signin?a=1&via=google`,
    })
  })

  it('rejects a social sign-in that does not start', async () => {
    stubFetch(() => new Response('{}', { status: 404 }))
    await expect(socialSignInUrl('microsoft', '/signin')).rejects.toMatchObject({ status: 404 })
  })
})
