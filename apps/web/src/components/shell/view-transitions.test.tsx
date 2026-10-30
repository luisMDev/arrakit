import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { answer, setupTestApi } from '#/test/rpc'

import { meAs, renderApp } from './testing'
import { viewTransitionRouterOptions } from './view-transitions'

setupTestApi({ onUnhandledFrame: 'error' })
afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition')
})

function stubStartViewTransition() {
  const start = vi.fn((update: ViewTransitionUpdateCallback | StartViewTransitionOptions) => {
    const run = typeof update === 'function' ? update : update.update
    const done = Promise.resolve(run?.())
    return { updateCallbackDone: done, ready: done, finished: done, skipTransition: () => {} }
  })
  Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true })
  return start
}

describe('View transitions', () => {
  it('turns them on for every navigation', () => {
    expect(viewTransitionRouterOptions.defaultViewTransition).toBe(true)
  })

  it('keeps the site header out of the page fade', async () => {
    renderApp('/unavailable')
    await screen.findByRole('link', { name: 'Home' })
    expect(document.querySelector('header')).toHaveClass('[view-transition-name:site-header]')
  })

  it('keeps the app bar out of the page fade', async () => {
    answer('me/get', meAs())
    renderApp('/app')
    await screen.findByRole('button', { name: 'Account menu' })
    expect(screen.getByRole('navigation', { name: 'Account' })).toHaveClass(
      '[view-transition-name:app-bar]',
    )
    expect(document.querySelector('header')).toHaveClass('[view-transition-name:site-header]')
  })

  it('runs a navigation inside a view transition where the browser has them', async () => {
    answer('me/get', meAs())
    const { location } = renderApp('/app')
    const menuButton = await screen.findByRole('button', { name: 'Account menu' })
    const start = stubStartViewTransition()
    const user = userEvent.setup()
    await user.click(menuButton)
    const menu = document.querySelector<HTMLElement>('#app-menu')!
    await user.click(within(menu).getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    expect(location()).toBe('/app/settings')
    expect(start).toHaveBeenCalled()
  })
})
