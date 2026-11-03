import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { answer, meAs, quiet, setupTestApi } from '#/test/rpc'

import { renderApp } from './testing'

const { signOut, listOrganizations } = vi.hoisted(() => ({
  signOut: vi.fn(),
  listOrganizations: vi.fn(),
}))
vi.mock('#/lib/auth-client', () => ({
  authClient: { signOut, organization: { list: listOrganizations } },
}))

setupTestApi({ onUnhandledFrame: 'error' })

async function open(url = '/app', me = meAs()) {
  answer('me/get', me)
  listOrganizations.mockResolvedValue({ data: [me.organization], error: null })
  const app = renderApp(url)
  const menuButton = await screen.findByRole('button', { name: 'Account menu' })
  const menu = () => screen.queryByRole('menu')
  const user = userEvent.setup()
  const openMenu = async () => {
    await user.click(menuButton)
    return menu()!
  }
  return { ...app, menuButton, menu, openMenu, user }
}

const sidebar = () => screen.getByRole('navigation', { name: 'Navigation' })
const sidebarLink = (name: string) => within(sidebar()).getByRole('link', { name })
const settingsNav = () => screen.getByRole('navigation', { name: 'Settings' })
const panel = () => document.querySelector<HTMLElement>('[data-panel]')!
const destinations = () =>
  within(sidebar())
    .getAllByRole('link')
    .map((link) => link.textContent)

describe('Signed-in shell', () => {
  it('shows the person, the organization and its plan at the foot of the sidebar', async () => {
    const { menuButton } = await open()
    expect(menuButton.closest('[data-sidebar="footer"]')).not.toBeNull()
    expect(menuButton).toHaveTextContent('L')
    expect(menuButton).toHaveTextContent('Lucía Gómez')
    expect(menuButton).toHaveTextContent('Acme · Team')
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('has no header in the app: the wordmark and the toggle head the sidebar', async () => {
    await open()
    expect(document.querySelectorAll('header')).toHaveLength(0)
    const head = document.querySelector<HTMLElement>('[data-sidebar="header"]')!
    expect(within(head).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/app')
    expect(head).toHaveTextContent('Arrakit')
    expect(
      within(head).getByRole('button', { name: 'Show or hide navigation' }),
    ).toBeInTheDocument()
  })

  it('opens the account menu with the person, the organizations, the theme and sign out', async () => {
    const { openMenu, menuButton } = await open()
    const menu = await openMenu()
    expect(menuButton).toHaveAttribute('aria-expanded', 'true')
    expect(menu).toHaveTextContent('Lucía Gómez')
    expect(menu).toHaveTextContent('lucia@acme.com')
    expect(await within(menu).findByRole('menuitemradio', { name: /Acme/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    for (const item of ['Create organization', 'Theme', 'Sign out'])
      expect(within(menu).getByRole('menuitem', { name: item })).toBeInTheDocument()
  })

  it('switches to dark mode from the theme submenu and remembers it', async () => {
    const { openMenu, user } = await open()
    await user.click(within(await openMenu()).getByRole('menuitem', { name: 'Theme' }))
    expect(await screen.findByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    screen.getByRole('menuitemradio', { name: 'Dark' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
    expect(localStorage.getItem('arrakit.theme')).toBe('dark')

    await user.click(within(await openMenu()).getByRole('menuitem', { name: 'Theme' }))
    ;(await screen.findByRole('menuitemradio', { name: 'Light' })).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'))
    localStorage.removeItem('arrakit.theme')
  })

  it('closes the menu on Escape, giving focus back, and on a click outside it', async () => {
    const { openMenu, menu, menuButton, user } = await open()
    await openMenu()
    await user.keyboard('{Escape}')
    expect(menu()).toBeNull()
    expect(menuButton).toHaveFocus()

    await openMenu()
    // The open menu is modal: Radix turns off pointer events outside it until it closes.
    await userEvent.setup({ pointerEventsCheck: 0 }).click(document.body)
    await waitFor(() => expect(menu()).toBeNull())
  })

  it('lists every destination in the sidebar, in the order the app declares them', async () => {
    await open()
    expect(destinations()).toEqual(['Home', 'Workspaces', 'Settings', 'Members', 'Billing'])
  })

  it('marks where the person is in the sidebar', async () => {
    const { location, user } = await open()
    expect(sidebarLink('Home')).toHaveAttribute('aria-current', 'page')
    await user.click(sidebarLink('Workspaces'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Workspaces' })).toBeInTheDocument()
    expect(location()).toBe('/app/workspaces')
    expect(sidebarLink('Workspaces')).toHaveAttribute('aria-current', 'page')
    expect(sidebarLink('Home')).not.toHaveAttribute('aria-current')
  })

  it("swaps the sidebar for Settings' sections, sliding them in, and Back slides the app's in", async () => {
    const { location, user } = await open()
    expect(panel()).not.toHaveClass('animate-in')
    await user.click(sidebarLink('Settings'))

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Navigation' })).toBeNull()
    const settings = settingsNav()
    expect(within(settings).getByRole('link', { name: 'Account' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(panel()).toHaveAttribute('data-panel', 'settings')
    expect(panel()).toHaveClass('animate-in', 'slide-in-from-right-8')

    await user.click(within(settings).getByRole('link', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Hi, Lucía Gómez.' })).toBeInTheDocument()
    expect(location()).toBe('/app')
    expect(sidebarLink('Home')).toHaveAttribute('aria-current', 'page')
    expect(panel()).toHaveAttribute('data-panel', 'app')
    expect(panel()).toHaveClass('animate-in', 'slide-in-from-left-8')
  })

  it.each([
    ['Settings', '/app/settings', 'Account'],
    ['Members', '/app/settings?section=members', 'Members'],
    ['Billing', '/app/settings?section=billing', 'Billing'],
  ])('reaches %s, marking its section in the Settings sidebar', async (item, path, section) => {
    const { location, user } = await open()
    await user.click(sidebarLink(item))
    expect(await screen.findByRole('heading', { level: 2, name: section })).toBeInTheDocument()
    expect(location()).toBe(path)
    const marked = within(settingsNav())
      .getAllByRole('link')
      .filter((link) => link.ariaCurrent)
    expect(marked.map((link) => link.textContent)).toEqual([section])
  })

  it('opens straight on a settings section with its sidebar, without sliding it in', async () => {
    await open('/app/settings?section=teams')
    await screen.findByRole('heading', { level: 1, name: 'Settings' })
    expect(within(settingsNav()).getByRole('link', { name: 'Teams' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(panel()).not.toHaveClass('animate-in')
  })

  it('opens Workspaces from the sidebar', async () => {
    const { location, user } = await open()
    await user.click(sidebarLink('Workspaces'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Workspaces' })).toBeInTheDocument()
    expect(location()).toBe('/app/workspaces')
  })

  it('hides Workspaces from a role without workspace read, and sends it Home from there', async () => {
    const auditor = meAs({ role: 'auditor', permissions: { usage: ['read'] } })
    const { location } = await open('/app/workspaces', auditor)
    expect(await screen.findByRole('heading', { name: 'Hi, Lucía Gómez.' })).toBeInTheDocument()
    expect(location()).toBe('/app')
    expect(destinations()).not.toContain('Workspaces')
  })

  it('leaves Billing and Members out of the sidebar of a member', async () => {
    await open('/app', meAs({ role: 'member' }))
    expect(destinations()).toEqual(['Home', 'Workspaces', 'Settings'])
  })

  it("shows Members and Billing in the sidebar of the organization's admin", async () => {
    await open('/app', meAs({ role: 'admin' }))
    expect(destinations()).toEqual(['Home', 'Workspaces', 'Settings', 'Members', 'Billing'])
  })

  it('collapses the sidebar to icons and opens it again from the toggle', async () => {
    const { user } = await open()
    const toggle = within(
      document.querySelector<HTMLElement>('[data-sidebar="header"]')!,
    ).getByRole('button', { name: 'Show or hide navigation' })
    const state = () => document.querySelector('[data-slot="sidebar"]')?.getAttribute('data-state')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(state()).toBe('expanded')
    await user.click(toggle)
    expect(state()).toBe('collapsed')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(state()).toBe('expanded')
  })

  it('opens the sidebar as a sheet on a phone, closing it on the way to a destination', async () => {
    const width = window.innerWidth
    window.innerWidth = 390
    try {
      answer('me/get', meAs())
      const { location } = renderApp('/app')
      const user = userEvent.setup()
      const toggle = await screen.findByRole('button', { name: 'Show or hide navigation' })
      expect(screen.queryByRole('navigation', { name: 'Navigation' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull()
      expect(toggle).toHaveAttribute('aria-expanded', 'false')

      await user.click(toggle)
      await user.click(
        await within(await screen.findByRole('dialog')).findByRole('link', { name: 'Workspaces' }),
      )

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Workspaces' }),
      ).toBeInTheDocument()
      expect(location()).toBe('/app/workspaces')
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    } finally {
      window.innerWidth = width
    }
  })

  it('shows a blank name as the email local part', async () => {
    const { openMenu } = await open('/app', meAs({ name: '  ' }))
    expect(await openMenu()).toHaveTextContent('lucia')
  })

  it('signs out to Sign in', async () => {
    signOut.mockResolvedValue({ data: { success: true }, error: null })
    const { openMenu, location, user, queryClient } = await open()
    answer('me/get', 401)
    await user.click(within(await openMenu()).getByRole('menuitem', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(location()).toBe('/signin')
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data ?? null),
    ).toEqual([null])
  })

  it('stays and says so when signing out fails', async () => {
    quiet()
    signOut.mockResolvedValue({ data: null, error: { status: 500, message: 'boom' } })
    const { openMenu, location, user } = await open()
    await user.click(within(await openMenu()).getByRole('menuitem', { name: 'Sign out' }))
    expect(await screen.findByText("Couldn't sign you out. Try again.")).toBeInTheDocument()
    expect(location()).toBe('/app')
  })
})

describe('requireUser', () => {
  it('sends a person the API does not recognise to sign in', async () => {
    answer('me/get', 401)
    const { location } = renderApp('/app')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(location()).toBe('/signin')
  })

  it('keeps a person off sign in when the API cannot be reached, and says so', async () => {
    const report = quiet()
    answer('me/get', 500)
    const { location } = renderApp('/app')
    expect(
      await screen.findByRole('heading', { name: "Couldn't reach Arrakit." }),
    ).toBeInTheDocument()
    expect(location()).toBe('/unavailable?next=%2Fapp')
    expect(report).toHaveBeenCalled()
  })

  it('sends a person the API refuses to Unavailable, like any other failure', async () => {
    quiet()
    answer('me/get', 403)
    const { location } = renderApp('/app/settings')
    expect(
      await screen.findByRole('heading', { name: "Couldn't reach Arrakit." }),
    ).toBeInTheDocument()
    expect(location()).toBe('/unavailable?next=%2Fapp%2Fsettings')
  })

  it('sends a person with no organization to create one', async () => {
    answer('me/get', meAs({ organization: null, role: null, plan: null, seats: null }))
    const { location } = renderApp('/app')
    expect(await screen.findByRole('heading', { name: 'Your organization' })).toBeInTheDocument()
    expect(location()).toBe('/profile')
  })

  it.each(['/app/booking', '/app/booked'])(
    'shows the not-found page inside the shell for an unknown %s',
    async (url) => {
      answer('me/get', meAs())
      const { location } = renderApp(url)
      expect(
        await screen.findByRole('heading', { name: 'This page does not exist.' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument()
      expect(location()).toBe(url)
    },
  )

  it('sends / to sign in', async () => {
    answer('me/get', 401)
    const { location } = renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(location()).toBe('/signin')
  })

  it('shows a not-found page for an unknown path outside /app', async () => {
    const { location } = renderApp('/nope')
    expect(
      await screen.findByRole('heading', { name: 'This page does not exist.' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back home' })).toHaveAttribute('href', '/')
    expect(location()).toBe('/nope')
  })

  it('applies the account language before the first signed-in render', async () => {
    const { i18n, loadLanguage } = await import('#/i18n')
    answer('me/get', meAs({ language: 'es' }))
    renderApp('/app')
    expect(await screen.findByRole('heading', { name: 'Hola, Lucía Gómez.' })).toBeInTheDocument()
    expect(i18n.language).toBe('es')
    expect(screen.queryByText('Hi, Lucía Gómez.')).toBeNull()
    await loadLanguage('en')
    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
  })

  it("keeps the account language when this browser's own language is still loading", async () => {
    const { i18n, loadLanguage } = await import('#/i18n')
    const original = i18n.changeLanguage.bind(i18n)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    // The remembered Spanish is still loading (a slow lazy chunk) when the guard runs.
    const changeLanguage = vi
      .spyOn(i18n, 'changeLanguage')
      .mockImplementationOnce(async (...args) => {
        await gate
        return original(...args)
      })
    const initial = loadLanguage('es')
    await vi.waitFor(() => expect(changeLanguage).toHaveBeenCalled())
    expect(i18n.language).toBe('en')
    answer('me/get', meAs({ language: 'en' }))
    renderApp('/app')
    setTimeout(release, 20)
    expect(await screen.findByRole('heading', { name: 'Hi, Lucía Gómez.' })).toBeInTheDocument()
    await initial
    await waitFor(() => expect(i18n.language).toBe('en'))
    expect(screen.getByRole('heading', { name: 'Hi, Lucía Gómez.' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
    expect(window.localStorage.getItem('arrakit.lang')).toBe('en')
    changeLanguage.mockRestore()
  })

  it('opens the app in the current language when the account language will not load', async () => {
    const { i18n } = await import('#/i18n')
    const changeLanguage = vi
      .spyOn(i18n, 'changeLanguage')
      .mockRejectedValueOnce(new TypeError('Importing a module script failed.'))
    const errors = quiet()
    answer('me/get', meAs({ language: 'es' }))
    const { location } = renderApp('/app')
    expect(await screen.findByRole('heading', { name: 'Hi, Lucía Gómez.' })).toBeInTheDocument()
    expect(location()).toBe('/app')
    expect(errors).toHaveBeenCalledWith(
      '[requireUser] loading the account language failed',
      expect.any(TypeError),
    )
    changeLanguage.mockRestore()
    errors.mockRestore()
  })
})
