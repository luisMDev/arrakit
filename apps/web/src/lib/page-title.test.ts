import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { APP_NAME } from '#/config'
import { loadLanguage } from '#/i18n'

import { retitleOnLanguageChange, titled } from './page-title'

function routerAt(path: string) {
  const rootRoute = createRootRoute()
  const page = createRoute({ getParentRoute: () => rootRoute, path, head: titled('pricing') })
  return createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
}

const metaTitleOf = (router: ReturnType<typeof routerAt>) =>
  router.state.matches.flatMap((match) => match.meta ?? []).find((meta) => meta?.title)?.title

describe('page titles', () => {
  beforeEach(() => {
    document.title = ''
  })
  afterEach(() => loadLanguage('en'))

  it('follows a live language switch without reloading the router', async () => {
    const router = routerAt('/pricing')
    const stop = retitleOnLanguageChange(router)
    await router.load()
    expect(metaTitleOf(router)).toBe(`${APP_NAME} · Pricing`)
    const invalidate = vi.spyOn(router, 'invalidate')

    await loadLanguage('es')
    await expect.poll(() => document.title).toBe(`${APP_NAME} · Precios`)
    expect(invalidate).not.toHaveBeenCalled()
    stop()
  })

  it('stops following once unsubscribed', async () => {
    const router = routerAt('/pricing')
    retitleOnLanguageChange(router)()
    await router.load()
    await loadLanguage('es')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.title).toBe('')
  })
})
