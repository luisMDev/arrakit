import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { answer, api, quiet } from '#/test/rpc'

import { PAID_WAIT_TRIES } from './on-paid-plan'
import { meAs, renderApp } from './testing'
import { safeNext } from './unavailable-page'

beforeAll(() => api.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  api.resetHandlers()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
afterAll(() => api.close())

describe('Home', () => {
  it('greets the person and names the organization and its plan', async () => {
    answer('me/get', meAs())
    renderApp('/app')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hi, Ana Ruiz.' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Acme is on Pro\./)).toBeInTheDocument()
  })

  it('gives an admin Settings, Members and Plans', async () => {
    answer('me/get', meAs({ role: 'admin' }))
    renderApp('/app')
    const main = await screen.findByRole('main')
    expect(within(main).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/app/settings',
    )
    expect(within(main).getByRole('link', { name: 'Members' })).toHaveAttribute(
      'href',
      '/app/members',
    )
    expect(within(main).getByRole('link', { name: 'Plans' })).toHaveAttribute('href', '/app/plans')
  })

  it('gives a member Settings only', async () => {
    answer('me/get', meAs({ role: 'member' }))
    renderApp('/app')
    const main = await screen.findByRole('main')
    expect(within(main).getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    expect(within(main).queryByRole('link', { name: 'Members' })).toBeNull()
    expect(within(main).queryByRole('link', { name: 'Plans' })).toBeNull()
  })

  it('opens Settings', async () => {
    answer('me/get', meAs())
    const { location } = renderApp('/app')
    const main = await screen.findByRole('main')
    await userEvent.click(within(main).getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument()
    expect(location()).toBe('/app/settings')
  })
})

describe('Welcome', () => {
  it.each([
    ['pro', 'Welcome to Pro.'],
    ['team', 'Welcome to Team.'],
  ] as const)('welcomes an organization on %s', async (plan, title) => {
    answer('me/get', meAs({ plan }))
    renderApp('/app/welcome')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(title)
    expect(screen.getByRole('link', { name: 'Go to the app →' })).toHaveAttribute('href', '/app')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/app/billing')
  })

  it('sends an organization on Free with no checkout to Plans', async () => {
    answer('me/get', meAs({ plan: 'free' }))
    const { location } = renderApp('/app/welcome')
    expect(await screen.findByRole('heading', { name: 'Plans' })).toBeInTheDocument()
    expect(location()).toBe('/app/plans')
  })

  it('waits for the webhook to move the plan after Checkout', async () => {
    const me = answer(
      'me/get',
      meAs({ plan: 'free' }),
      meAs({ plan: 'free' }),
      meAs({ plan: 'free' }),
      meAs({ plan: 'pro' }),
    )
    renderApp('/app/welcome?session_id=cs_test_1')
    expect(await screen.findByRole('heading', { level: 1 }, { timeout: 5000 })).toHaveTextContent(
      'Welcome to Pro.',
    )
    expect(me.length).toBe(4)
  })

  it(`gives up after ${PAID_WAIT_TRIES} tries, a second apart, and opens Plans`, async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const me = answer('me/get', meAs({ plan: 'free' }))
    const { location } = renderApp('/app/welcome?session_id=cs_test_1')
    for (let second = 0; second < PAID_WAIT_TRIES + 1; second++) {
      await act(() => vi.advanceTimersByTimeAsync(1000))
    }
    expect(await screen.findByRole('heading', { name: 'Plans' })).toBeInTheDocument()
    expect(location()).toBe('/app/plans')
    expect(me.length).toBe(1 + PAID_WAIT_TRIES)
  })

  it('opens Plans when reading the plan fails while waiting', async () => {
    quiet()
    answer('me/get', meAs({ plan: 'free' }), 500)
    const { location } = renderApp('/app/welcome?session_id=cs_test_1')
    expect(await screen.findByRole('heading', { name: 'Plans' })).toBeInTheDocument()
    expect(location()).toBe('/app/plans')
  })
})

describe('Unavailable', () => {
  it('says the API could not be reached and tries again once it answers', async () => {
    quiet()
    answer('me/get', 500, 500, meAs())
    const { location } = renderApp('/app/settings')
    const tryAgain = await screen.findByRole('button', { name: 'Try again' })
    expect(screen.getByText('Nothing is lost. Try again in a moment.')).toBeInTheDocument()
    expect(location()).toBe('/unavailable?next=%2Fapp%2Fsettings')

    await userEvent.click(tryAgain)
    expect(
      await screen.findByRole('heading', { name: "Couldn't reach Arrakit." }),
    ).toBeInTheDocument()
    expect(location()).toBe('/unavailable?next=%2Fapp%2Fsettings')

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument()
    expect(location()).toBe('/app/settings')
  })

  it('goes to /profile when that was the screen wanted', async () => {
    const { location } = renderApp('/unavailable?next=%2Fprofile')
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Your organization' })).toBeInTheDocument()
    expect(location()).toBe('/profile')
  })

  it('names who can help when the account is forbidden, with no Try again', async () => {
    renderApp('/unavailable?reason=forbidden')
    expect(
      await screen.findByRole('heading', { name: "Your account can't open Arrakit right now." }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Ask your organization's admin/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      'https://example.com',
    )
  })

  it.each([
    '/pricing',
    'https://evil.example/app',
    '//evil.example/app',
    '/application',
    undefined,
  ])('turns next=%s into /app', (next) => {
    expect(safeNext(next)).toBe('/app')
  })

  it.each(['/app', '/app/settings', '/app?x=1', '/profile', '/signup'])('keeps next=%s', (next) => {
    expect(safeNext(next)).toBe(next)
  })
})
