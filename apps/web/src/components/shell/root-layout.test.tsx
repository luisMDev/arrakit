import { screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { isInApp } from './root-layout'
import { RETRIED_AT_KEY } from './stale-chunk'
import { api, meAnswers, meAs, renderApp } from './testing'

beforeAll(() => api.listen({ onUnhandledFrame: 'error' }))
afterEach(() => api.resetHandlers())
afterAll(() => api.close())

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
      meAnswers(meAs())
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
    sessionStorage.removeItem(RETRIED_AT_KEY)
  })

  it("answers Vite's preload error on every screen", async () => {
    renderApp('/unavailable')
    await screen.findByRole('link', { name: 'Home' })
    const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(''))
    const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), {
      payload: new TypeError('Importing a module script failed.'),
    })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(sessionStorage.getItem(RETRIED_AT_KEY)).not.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
