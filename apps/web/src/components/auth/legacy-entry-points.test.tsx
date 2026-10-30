import { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { routeTree } from '#/routeTree.gen'

function routerAt(url: string) {
  return createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [url] }),
  })
}

afterEach(() => vi.restoreAllMocks())

describe('legacy entry points', () => {
  it.each(['/start', '/new'])('%s lands on /signup keeping the whole query', async (path) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(null))
    const router = routerAt(`${path}?plan=pro&cycle=yearly&utm_source=news&ref=friend`)
    await router.load()
    const { pathname, searchStr } = router.state.location
    expect(pathname).toBe('/signup')
    expect(Object.fromEntries(new URLSearchParams(searchStr))).toEqual({
      plan: 'pro',
      cycle: 'yearly',
      utm_source: 'news',
      ref: 'friend',
    })
  })
})
