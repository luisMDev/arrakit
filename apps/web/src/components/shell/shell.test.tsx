import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { api, meAnswers, meAs, renderApp } from './testing'

const signOut = vi.hoisted(() => vi.fn())
vi.mock('#/lib/auth-client', () => ({ authClient: { signOut } }))

beforeAll(() => api.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  api.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => api.close())

async function open(url = '/app', me = meAs()) {
  meAnswers(me)
  const app = renderApp(url)
  const menuButton = await screen.findByRole('button', { name: 'Account menu' })
  const menu = () => document.querySelector<HTMLElement>('#app-menu')
  const user = userEvent.setup()
  const openMenu = async () => {
    await user.click(menuButton)
    return menu()!
  }
  return { ...app, menuButton, menu, openMenu, user }
}

describe('Signed-in shell', () => {
  it("shows the organization and its plan next to the person's initial", async () => {
    const { menuButton } = await open()
    expect(screen.getByRole('navigation', { name: 'Account' })).toHaveTextContent('Acme · Pro')
    expect(menuButton).toHaveTextContent('A')
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    expect(menuButton).toHaveAttribute('aria-controls', 'app-menu')
  })

  it('renders exactly one header with the wordmark', async () => {
    await open()
    expect(document.querySelectorAll('header')).toHaveLength(1)
    expect(
      within(document.querySelector('header')!).getByRole('link', { name: 'Home' }),
    ).toHaveAttribute('href', '/app')
  })

  it('opens the app menu with the person, the organization and every destination', async () => {
    const { openMenu, menuButton } = await open()
    const menu = await openMenu()
    expect(menuButton).toHaveAttribute('aria-expanded', 'true')
    expect(menu).toHaveTextContent('Ana Ruiz')
    expect(menu).toHaveTextContent('Acme · Pro')
    for (const item of ['Home', 'Settings', 'Members', 'Billing'])
      expect(within(menu).getByRole('link', { name: item })).toBeInTheDocument()
    expect(within(menu).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('closes the menu on Escape, giving focus back, and on a click outside it', async () => {
    const { openMenu, menu, menuButton, user } = await open()
    await openMenu()
    await user.keyboard('{Escape}')
    expect(menu()).toBeNull()
    expect(menuButton).toHaveFocus()

    await openMenu()
    await user.click(document.body)
    expect(menu()).toBeNull()
  })

  it('navigates from the menu and closes it', async () => {
    const { openMenu, menu, location, user } = await open()
    await user.click(within(await openMenu()).getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    expect(location()).toBe('/app/settings')
    expect(menu()).toBeNull()
  })

  it('opens Home from the menu', async () => {
    const { openMenu, location, user } = await open('/app/settings')
    await user.click(within(await openMenu()).getByRole('link', { name: 'Home' }))
    expect(await screen.findByRole('heading', { name: 'Hi, Ana Ruiz.' })).toBeInTheDocument()
    expect(location()).toBe('/app')
  })

  it.each([
    ['Settings', '/app/settings', 'Account'],
    ['Members', '/app/members', 'Members'],
    ['Billing', '/app/billing', 'Billing'],
  ])('reaches %s with its section heading', async (item, path, section) => {
    const { openMenu, location, user } = await open()
    await user.click(within(await openMenu()).getByRole('link', { name: item }))
    expect(await screen.findByRole('heading', { level: 2, name: section })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    expect(location()).toBe(path)
  })

  it('leaves Billing and Members out of the menu of a member', async () => {
    const { openMenu } = await open('/app', meAs({ role: 'member' }))
    const menu = await openMenu()
    expect(menu).not.toHaveTextContent('Billing')
    expect(menu).not.toHaveTextContent('Members')
    expect(within(menu).getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })

  it("shows Members and Billing in the menu of the organization's admin", async () => {
    const { openMenu } = await open('/app', meAs({ role: 'admin' }))
    const menu = await openMenu()
    expect(within(menu).getByRole('link', { name: 'Members' })).toBeInTheDocument()
    expect(within(menu).getByRole('link', { name: 'Billing' })).toBeInTheDocument()
  })

  it('shows a blank name as the email local part', async () => {
    const { openMenu } = await open('/app', meAs({ name: '  ' }))
    expect(await openMenu()).toHaveTextContent('ana')
  })

  it('signs out to Sign in', async () => {
    signOut.mockResolvedValue({ data: { success: true }, error: null })
    const { openMenu, location, user, queryClient } = await open()
    await user.click(within(await openMenu()).getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(location()).toBe('/signin')
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('stays and says so when signing out fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    signOut.mockResolvedValue({ data: null, error: { status: 500, message: 'boom' } })
    const { openMenu, location, user } = await open()
    await user.click(within(await openMenu()).getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText("Couldn't sign you out. Try again.")).toBeInTheDocument()
    expect(location()).toBe('/app')
  })
})

describe('requireUser', () => {
  it('sends a person the API does not recognise to sign in', async () => {
    meAnswers(401)
    const { location } = renderApp('/app')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(location()).toBe('/signin')
  })

  it('keeps a person off sign in when the API cannot be reached, and says so', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    meAnswers(500)
    const { location } = renderApp('/app')
    expect(
      await screen.findByRole('heading', { name: "Couldn't reach Arrakit." }),
    ).toBeInTheDocument()
    expect(location()).toBe('/unavailable?next=%2Fapp')
    expect(report).toHaveBeenCalled()
  })

  it('keeps a person the API forbids off sign in, and says who can help', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    meAnswers(403)
    const { location } = renderApp('/app/settings')
    expect(
      await screen.findByRole('heading', { name: "Your account can't open Arrakit right now." }),
    ).toBeInTheDocument()
    expect(location()).toBe('/unavailable?reason=forbidden')
  })

  it('sends a person with no organization to create one', async () => {
    meAnswers(meAs({ organization: null, role: null, plan: null, seats: null }))
    const { location } = renderApp('/app')
    expect(await screen.findByRole('heading', { name: 'Your organization' })).toBeInTheDocument()
    expect(location()).toBe('/profile')
  })

  it.each(['/app/booking', '/app/booked'])('lands an unknown %s on Home', async (url) => {
    meAnswers(meAs())
    const { location } = renderApp(url)
    expect(await screen.findByRole('heading', { name: 'Hi, Ana Ruiz.' })).toBeInTheDocument()
    expect(location()).toBe('/app')
  })

  it('sends / to sign in', async () => {
    const { location } = renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(location()).toBe('/signin')
  })

  it('applies the account language before the first signed-in render', async () => {
    const { i18n, loadLanguage } = await import('#/i18n')
    meAnswers(meAs({ language: 'es' }))
    renderApp('/app')
    expect(await screen.findByRole('heading', { name: 'Hola, Ana Ruiz.' })).toBeInTheDocument()
    expect(i18n.language).toBe('es')
    expect(screen.queryByText('Hi, Ana Ruiz.')).toBeNull()
    await loadLanguage('en')
    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
  })

  it('opens the app in the current language when the account language will not load', async () => {
    const { i18n } = await import('#/i18n')
    const changeLanguage = vi
      .spyOn(i18n, 'changeLanguage')
      .mockRejectedValueOnce(new TypeError('Importing a module script failed.'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    meAnswers(meAs({ language: 'es' }))
    const { location } = renderApp('/app')
    expect(await screen.findByRole('heading', { name: 'Hi, Ana Ruiz.' })).toBeInTheDocument()
    expect(location()).toBe('/app')
    expect(errors).toHaveBeenCalledWith(
      '[requireUser] loading the account language failed',
      expect.any(TypeError),
    )
    changeLanguage.mockRestore()
    errors.mockRestore()
  })
})
