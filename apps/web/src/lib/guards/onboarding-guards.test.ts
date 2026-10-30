import type { Me } from '@arrakit/contract'
import { isRedirect } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '#/i18n'
import { testQueryClient } from '#/test/rpc'

import { requireAccount } from './require-account'
import { skipWhenSignedIn } from './skip-when-signed-in'

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

const skip = (search: Record<string, string> = {}, href = '/signin') =>
  outcome(() =>
    skipWhenSignedIn({ context: { queryClient: testQueryClient() }, location: { href }, search }),
  )

const account = (search: Record<string, string> = {}, href = '/profile') =>
  outcome(() =>
    requireAccount({ context: { queryClient: testQueryClient() }, location: { href }, search }),
  )

let reported: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  reported = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('skipWhenSignedIn (/signup, /signin)', () => {
  it('renders the page for a visitor, reporting nothing', async () => {
    api(visitor)
    expect(await skip()).toBe('render')
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
})

describe('any failure but a 401', () => {
  it.each([
    ['a network failure', 'network' as const],
    ['a 403', { status: 403 }],
    ['a 503', { status: 503 }],
  ])('sends %s to Unavailable with next, and reports it', async (_, answer) => {
    api(answer)
    expect(await account({}, '/profile?plan=team&cycle=monthly')).toEqual({
      to: '/unavailable',
      search: { next: '/profile?plan=team&cycle=monthly' },
    })
    expect(await skip({}, '/signin?plan=pro')).toEqual({
      to: '/unavailable',
      search: { next: '/signin?plan=pro' },
    })
    expect(reported).toHaveBeenCalledWith('[me.get] failed', expect.anything())
  })
})
