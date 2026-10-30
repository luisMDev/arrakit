import type { Me } from '@arrakit/contract'
import { QueryClient } from '@tanstack/react-query'
import { type ParsedLocation, isRedirect } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '#/i18n'

import { requireAccount } from './require-account'
import { skipWhenSignedIn } from './skip-when-signed-in'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (message: string) => toastError(message) } }))

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

function api({ session, rpc }: { session: Answer; rpc?: Answer }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)
      const answer = url.includes('/api/auth/get-session') ? session : rpc
      if (!answer || answer === 'network') throw new TypeError('Failed to fetch')
      const body = url.includes('/api/rpc')
        ? answer.status === 200
          ? { json: answer.body }
          : { json: { defined: false, code: 'ERR', status: answer.status, message: 'x' } }
        : answer.body
      return new Response(JSON.stringify(body ?? null), {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

const signedIn = { status: 200, body: { user: { email: 'ana@acme.com', name: 'Ana' } } }
const signedOut = { status: 200, body: null }

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

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  toastError.mockReset()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  consoleError.mockRestore()
})

describe('skipWhenSignedIn (/signup, /signin)', () => {
  it('renders the page for a visitor', async () => {
    api({ session: signedOut })
    expect(await skip()).toBe('render')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('sends a person without an organization to /profile, carrying the plan', async () => {
    api({ session: signedIn, rpc: { status: 200, body: me(null) } })
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
    api({ session: signedIn, rpc: { status: 200, body: me(ORG) } })
    expect(await skip()).toMatchObject({ to: '/app' })
    expect(await skip({ plan: 'pro', cycle: 'yearly' })).toEqual({
      to: '/app/checkout',
      search: { plan: 'pro', cycle: 'yearly' },
    })
  })

  it('treats a 401 as signed out without a toast', async () => {
    api({ session: signedIn, rpc: { status: 401 } })
    expect(await skip()).toBe('render')
    expect(toastError).not.toHaveBeenCalled()
  })

  it.each([
    ['a network failure', 'network' as const],
    ['a 503', { status: 503 }],
  ])('renders with the unreachable toast on %s', async (_, answer) => {
    api({ session: answer })
    expect(await skip()).toBe('render')
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't reach Arrakit. Check your connection and reload.",
    )
    expect(consoleError).toHaveBeenCalledWith(
      '[skipWhenSignedIn] the guard failed',
      expect.anything(),
    )
  })

  it('renders with the failed toast on another error', async () => {
    api({ session: signedIn, rpc: { status: 403 } })
    expect(await skip()).toBe('render')
    expect(toastError).toHaveBeenCalledWith('Something went wrong. Reload and try again.')
  })

  it('shows no toast while a link to the page is only preloaded', async () => {
    api({ session: 'network' })
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
    api({ session: signedIn, rpc: { status: 200, body: me(ORG) } })
    expect(await skip(refused)).toMatchObject({ to: '/app' })
    api({ session: signedOut })
    expect(await skip(refused)).toBe('render')
  })
})

describe('requireAccount (/profile)', () => {
  it('sends a visitor to /signup', async () => {
    api({ session: signedOut })
    expect(await account()).toMatchObject({ to: '/signup' })
  })

  it('renders Profile for a person without an organization', async () => {
    api({ session: signedIn, rpc: { status: 200, body: me(null) } })
    expect(await account()).toBe('render')
  })

  it('never shows the form to a member', async () => {
    api({ session: signedIn, rpc: { status: 200, body: me(ORG) } })
    expect(await account()).toMatchObject({ to: '/app' })
    expect(await account({ plan: 'team', cycle: 'monthly' })).toEqual({
      to: '/app/checkout',
      search: { plan: 'team', cycle: 'monthly' },
    })
  })

  it('sends a 401 to /signup without logging', async () => {
    api({ session: signedIn, rpc: { status: 401 } })
    expect(await account()).toMatchObject({ to: '/signup' })
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('sends a 403 to Unavailable forbidden', async () => {
    api({ session: signedIn, rpc: { status: 403 } })
    expect(await account()).toEqual({ to: '/unavailable', search: { reason: 'forbidden' } })
    expect(consoleError).toHaveBeenCalledWith(
      '[requireAccount] the guard failed',
      expect.anything(),
    )
  })

  it.each([
    ['a network failure', 'network' as const],
    ['a 503', { status: 503 }],
  ])('sends %s to Unavailable with next', async (_, answer) => {
    api({ session: answer })
    expect(await account({}, '/profile?plan=team&cycle=monthly')).toEqual({
      to: '/unavailable',
      search: { next: '/profile?plan=team&cycle=monthly' },
    })
  })
})
