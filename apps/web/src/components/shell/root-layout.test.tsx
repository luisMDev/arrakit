import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { answer, setupTestApi } from '#/test/rpc'

import { isInApp } from './root-layout'
import { RELOADED_AT_KEY } from './stale-chunk'
import { meAs, renderApp } from './testing'

setupTestApi({ onUnhandledFrame: 'error' })

describe('isInApp', () => {
  it.each(['/app', '/app/settings', '/app/anything/deep'])('%s is in the app', (path) => {
    expect(isInApp(path)).toBe(true)
  })

  it.each(['/', '/pricing', '/signin', '/application', '/unavailable', '/apply'])(
    '%s is not',
    (path) => {
      expect(isInApp(path)).toBe(false)
    },
  )
})

describe('Root layout', () => {
  it.each(['/signin', '/unavailable', '/pricing', '/apply'])(
    'links the wordmark to the website from %s',
    async (url) => {
      renderApp(url)
      const wordmark = await screen.findByRole('link', { name: 'Home' })
      expect(wordmark).toHaveAttribute('href', 'https://example.com')
      expect(document.querySelectorAll('header')).toHaveLength(1)
    },
  )

  it.each(['/app', '/app/settings', '/app?tab=1'])(
    'links the wordmark to Home from %s',
    async (url) => {
      answer('me/get', meAs())
      renderApp(url)
      await screen.findByRole('button', { name: 'Account menu' })
      const header = document.querySelector('header')!
      expect(header.querySelector('a')).toHaveAttribute('href', '/app')
      expect(header.querySelector('a')).toHaveAccessibleName('Home')
      expect(header).toHaveTextContent('Arrakit')
    },
  )
})

describe('Stale chunk recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    sessionStorage.removeItem(RELOADED_AT_KEY)
  })

  it("answers Vite's preload error on every screen", async () => {
    renderApp('/unavailable')
    await screen.findByRole('link', { name: 'Home' })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), {
      payload: new TypeError('Importing a module script failed.'),
    })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(sessionStorage.getItem(RELOADED_AT_KEY)).not.toBeNull()
  })
})

describe('Root route', () => {
  it("holds every screen until this browser's initial language has loaded", async () => {
    const { Route } = await import('#/routes/__root')
    const { i18n, loadLanguage } = await import('#/i18n')
    const original = i18n.changeLanguage.bind(i18n)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    // The remembered Spanish is still loading (a slow lazy chunk).
    const changeLanguage = vi
      .spyOn(i18n, 'changeLanguage')
      .mockImplementationOnce(async (...args) => {
        await gate
        return original(...args)
      })
    const initial = loadLanguage('es')
    await vi.waitFor(() => expect(changeLanguage).toHaveBeenCalled())
    let settled = false
    const beforeLoad = Route.options.beforeLoad as unknown as () => Promise<void>
    const held = beforeLoad().then(() => (settled = true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)
    expect(i18n.language).toBe('en')
    release()
    await held
    expect(i18n.language).toBe('es')
    await initial
    changeLanguage.mockRestore()
    await loadLanguage('en')
  })
})
