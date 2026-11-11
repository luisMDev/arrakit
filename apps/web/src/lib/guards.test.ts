import type { Me } from '@arrakit/contract'
import { isRedirect } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '#/i18n'
import type { ChoiceSearch } from '#/lib/checkout-choice'
import { orpc } from '#/lib/orpc'
import { meAs, testQueryClient } from '#/test/rpc'

import {
  canCheckout,
  requireAccount,
  requirePermission,
  skipWhenSignedIn,
  toWorkspaceHome,
} from './guards'
import { rememberWorkspace } from './last-workspace'

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
  permissions: {},
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

describe('requirePermission', () => {
  const visit = (permissions: Me['permissions']) => {
    const queryClient = testQueryClient()
    queryClient.setQueryData(orpc.me.get.queryOptions().queryKey, meAs({ permissions }))
    return outcome(async () =>
      requirePermission({ workspace: ['read'] })({ context: { queryClient } }),
    )
  }

  it('renders for a role that grants it', async () => {
    expect(await visit({ workspace: ['read', 'create'] })).toBe('render')
  })

  it('sends a role without it Home', async () => {
    expect(await visit({ usage: ['read'] })).toMatchObject({ to: '/app' })
  })
})

describe('toWorkspaceHome (/app)', () => {
  const DEALS = { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', name: 'Deals' }
  const RESEARCH = { id: '0f8fad5b-d9cb-469f-a165-708677289508', name: 'Research' }
  const home = (id: string) => ({ to: '/app/workspaces/$workspaceId', params: { workspaceId: id } })

  const visit = (answer: Answer, permissions: Me['permissions'] = { workspace: ['read'] }) => {
    api(answer)
    const queryClient = testQueryClient()
    queryClient.setQueryData(orpc.me.get.queryOptions().queryKey, meAs({ permissions }))
    return (async () => {
      try {
        await toWorkspaceHome({ context: { queryClient } })
        return 'render'
      } catch (err) {
        if (isRedirect(err)) return { to: err.options.to, params: err.options.params }
        throw err
      }
    })()
  }

  afterEach(() => localStorage.clear())

  it('renders the general Home for an organization without workspaces', async () => {
    expect(await visit({ status: 200, body: [] })).toBe('render')
  })

  it("opens the first workspace's Home", async () => {
    expect(await visit({ status: 200, body: [DEALS, RESEARCH] })).toEqual(home(DEALS.id))
  })

  it('opens the workspace last opened on this device, while it still exists', async () => {
    rememberWorkspace(ORG.id, RESEARCH.id)
    expect(await visit({ status: 200, body: [DEALS, RESEARCH] })).toEqual(home(RESEARCH.id))
    expect(await visit({ status: 200, body: [DEALS] })).toEqual(home(DEALS.id))
  })

  it('renders the general Home for a role that reads no workspaces, asking for none', async () => {
    expect(await visit({ status: 200, body: [DEALS] }, { usage: ['read'] })).toBe('render')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('renders the general Home when the workspaces do not load, reporting it', async () => {
    expect(await visit({ status: 500 })).toBe('render')
    expect(reported).toHaveBeenCalled()
  })
})

describe('canCheckout (/app/checkout)', () => {
  const checkout = (role: 'owner' | 'admin' | 'member', search: ChoiceSearch) => {
    const queryClient = testQueryClient()
    queryClient.setQueryData(orpc.me.get.queryOptions().queryKey, meAs({ plan: 'free', role }))
    return outcome(async () => canCheckout({ context: { queryClient }, search }))
  }

  it.each(['owner', 'admin'] as const)('lets an %s check out a paid plan', async (role) => {
    expect(await checkout(role, { plan: 'pro', cycle: 'monthly' })).toBe('render')
  })

  it('sends a member to Plans', async () => {
    expect(await checkout('member', { plan: 'pro', cycle: 'yearly' })).toMatchObject({
      to: '/app/plans',
    })
  })

  it.each([
    {},
    { plan: 'free', cycle: 'yearly' },
    { plan: 'enterprise', cycle: 'yearly' },
    { plan: 'internal', cycle: 'yearly' },
    { plan: 'Internal', cycle: 'yearly' },
    { plan: 'pro', cycle: 'weekly' },
    { plan: 'pro' },
  ])('sends %o to Plans', async (search) => {
    expect(await checkout('owner', search)).toMatchObject({ to: '/app/plans' })
  })

  it('hands the choice to the page', () => {
    const queryClient = testQueryClient()
    queryClient.setQueryData(orpc.me.get.queryOptions().queryKey, meAs({ plan: 'free' }))
    expect(
      canCheckout({ context: { queryClient }, search: { plan: 'pro', cycle: 'monthly' } }),
    ).toEqual({ choice: { plan: 'pro', cycle: 'monthly' } })
  })
})
