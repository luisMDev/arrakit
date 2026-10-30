import type { Me } from '@arrakit/contract'
import { QueryClient } from '@tanstack/react-query'
import { type ParsedLocation, isRedirect } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '#/i18n'
import { reportError } from '#/lib/api-errors'

import { requireAccount } from './require-account'
import { skipWhenSignedIn } from './skip-when-signed-in'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (message: string) => toastError(message) } }))
vi.mock('#/lib/api-errors', async (original) => ({
  ...(await original<typeof import('#/lib/api-errors')>()),
  reportError: vi.fn(),
}))
const reported = vi.mocked(reportError)

const ORG: NonNullable<Me['organization']> = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'Acme',
  slug: 'acme',
  plan: 'free',
}

const me = (organization: Me['organization']): Me => ({
  email: 'ana@acme.com',
  name: 'Ana',
  language: 'en',
  organization,
  role: organization ? 'owner' : null,
  plan: organization ? 'free' : null,
  seats: organization ? 1 : null,
})

type Answer = { status: number; body?: unknown } | 'network'

function api(answer: Answer) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (answer === 'network') throw new TypeError('Failed to fetch')
      const body =
        answer.status === 200
          ? { json: answer.body }
          : { json: { defined: false, code: 'ERR', status: answer.status, message: 'x' } }
      return Response.json(body, { status: answer.status })
    }),
  )
}

const visitor = { status: 401 }
const person = (organization: Me['organization']) => ({ status: 200, body: me(organization) })

async function outcome(run: () => Promise<unknown>) {
  try {
    await run()
    return 'render'
  } catch (err) {
    if (isRedirect(err)) return { to: err.options.to, search: err.options.search }
    throw err
  }
}

const skip = (search: Record<string, string> = {}) =>
  outcome(() => skipWhenSignedIn({ context: { queryClient: new QueryClient() }, search }))

const account = (search: Record<string, string> = {}, href = '/profile') =>
  outcome(() =>
    requireAccount({
      context: { queryClient: new QueryClient() },
      location: { href } as ParsedLocation,
      search,
    }),
  )

beforeEach(() => {
  toastError.mockReset()
  reported.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('skipWhenSignedIn (/signup, /signin)', () => {
  it('renders the page for a visitor', async () => {
    api(visitor)
    expect(await skip()).toBe('render')
    expect(toastError).not.toHaveBeenCalled()
    expect(reported).not.toHaveBeenCalled()
  })

  it('sends a person without an organization to /profile, carrying the plan', async () => {
    api(person(null))
    expect(await skip()).toEqual({ to: '/profile', search: {} })
    expect(await skip({ plan: 'team', cycle: 'monthly' })).toEqual({
      to: '/profile',
      search: { plan: 'team', cycle: 'monthly' },
    })
    expect(await skip({ plan: 'enterprise', cycle: 'monthly' })).toEqual({
      to: '/profile',
      search: {},
    })
  })

  it('sends a member to /app, or to checkout with a plan', async () => {
    api(person(ORG))
    expect(await skip()).toMatchObject({ to: '/app' })
    expect(await skip({ plan: 'pro', cycle: 'yearly' })).toEqual({
      to: '/app/checkout',
      search: { plan: 'pro', cycle: 'yearly' },
    })
  })

  it.each([
    ['a network failure', 'network' as const],
    ['a 503', { status: 503 }],
  ])('renders with the unreachable toast on %s', async (_, answer) => {
    api(answer)
    expect(await skip()).toBe('render')
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't reach Arrakit. Check your connection and reload.",
    )
    expect(reported).toHaveBeenCalledWith('[skipWhenSignedIn] the guard failed', expect.anything())
  })

  it('renders with the failed toast on another error', async () => {
    api({ status: 403 })
    expect(await skip()).toBe('render')
    expect(toastError).toHaveBeenCalledWith('Something went wrong. Reload and try again.')
  })

  it('renders with the unreachable toast when a proxy answers the me call with a 502 page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>Bad gateway</html>', {
            status: 502,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    )
    expect(await skip()).toBe('render')
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't reach Arrakit. Check your connection and reload.",
    )
  })

  it.each([
    ['a plain Error from the me call', () => Promise.reject(new Error('bug'))],
    [
      'a me answer that is not JSON',
      async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ],
    [
      'a TypeError from a bug',
      () => Promise.reject(new TypeError("Cannot read properties of undefined (reading 'x')")),
    ],
    [
      'a TypeError that only mentions fetch',
      () => Promise.reject(new TypeError('fetchQuery is not a function')),
    ],
  ])('does not blame the connection on %s, logs it and renders', async (_, answer) => {
    vi.stubGlobal('fetch', vi.fn(answer))
    expect(await skip()).toBe('render')
    expect(toastError).toHaveBeenCalledWith('Something went wrong. Reload and try again.')
    expect(toastError).not.toHaveBeenCalledWith(
      "Couldn't reach Arrakit. Check your connection and reload.",
    )
    expect(reported).toHaveBeenCalledWith('[skipWhenSignedIn] the guard failed', expect.anything())
  })

  it('shows no toast while a link to the page is only preloaded', async () => {
    api('network')
    const result = await outcome(() =>
      skipWhenSignedIn({
        context: { queryClient: new QueryClient() },
        search: {},
        cause: 'preload',
      }),
    )
    expect(result).toBe('render')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('sends a member who lands on a refused sign-in URL to /app, and lets a visitor see it', async () => {
    const refused = { error: 'INVALID_TOKEN', via: 'google' } as Record<string, string>
    api(person(ORG))
    expect(await skip(refused)).toMatchObject({ to: '/app' })
    api(visitor)
    expect(await skip(refused)).toBe('render')
  })
})

describe('requireAccount (/profile)', () => {
  it('sends a visitor to /signup without reporting', async () => {
    api(visitor)
    expect(await account()).toMatchObject({ to: '/signup' })
    expect(reported).not.toHaveBeenCalled()
  })

  it('renders Profile for a person without an organization', async () => {
    api(person(null))
    expect(await account()).toBe('render')
  })

  it('never shows the form to a member', async () => {
    api(person(ORG))
    expect(await account()).toMatchObject({ to: '/app' })
    expect(await account({ plan: 'team', cycle: 'monthly' })).toEqual({
      to: '/app/checkout',
      search: { plan: 'team', cycle: 'monthly' },
    })
  })

  it('sends a 403 to Unavailable forbidden', async () => {
    api({ status: 403 })
    expect(await account()).toEqual({ to: '/unavailable', search: { reason: 'forbidden' } })
    expect(reported).toHaveBeenCalledWith('[requireAccount] the guard failed', expect.anything())
  })

  it.each([
    ['a network failure', 'network' as const],
    ['a 503', { status: 503 }],
  ])('sends %s to Unavailable with next', async (_, answer) => {
    api(answer)
    expect(await account({}, '/profile?plan=team&cycle=monthly')).toEqual({
      to: '/unavailable',
      search: { next: '/profile?plan=team&cycle=monthly' },
    })
  })
})
