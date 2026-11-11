import type { Workspace } from '@arrakit/contract'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { answer, meAs, quiet, setupTestApi } from '#/test/rpc'

import { renderApp } from './testing'

const { signOut, listOrganizations, listMembers } = vi.hoisted(() => ({
  signOut: vi.fn(),
  listOrganizations: vi.fn(),
  listMembers: vi.fn(),
}))
vi.mock('#/lib/auth-client', () => ({
  authClient: { signOut, organization: { list: listOrganizations, listMembers } },
}))

setupTestApi({ onUnhandledFrame: 'error' })

async function open(url = '/app', me = meAs(), workspaces: Workspace[] = []) {
  answer('me/get', me)
  answer('workspaces/list', workspaces)
  listOrganizations.mockResolvedValue({ data: [me.organization], error: null })
  listMembers.mockResolvedValue({ data: { members: [], total: 3 }, error: null })
  const app = renderApp(url)
  await screen.findAllByRole('button', { name: 'Show or hide navigation' })
  // Absent in Settings, whose sidebar shows the person instead.
  const menuButton = screen.queryByRole('button', { name: 'Workspace menu' })!
  const menu = () => screen.queryByRole('menu')
  const user = userEvent.setup()
  const openMenu = async () => {
    await user.click(menuButton)
    return menu()!
  }
  const goTo = async (item: string) =>
    user.click(await within(await openMenu()).findByRole('menuitem', { name: item }))
  return { ...app, menuButton, menu, openMenu, goTo, user }
}

const DEALS: Workspace = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'Deals',
  description: '',
  createdOn: '2026-11-02',
}
const RESEARCH: Workspace = {
  ...DEALS,
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Research',
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
  it('heads the sidebar with the organization and its plan', async () => {
    const { menuButton } = await open()
    expect(menuButton.closest('[data-sidebar="header"]')).not.toBeNull()
    expect(document.querySelector('[data-sidebar="footer"]')).toBeNull()
    expect(menuButton).toHaveTextContent('A')
    expect(menuButton).toHaveTextContent('Acme')
    expect(menuButton).toHaveTextContent('Team')
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('group', { name: 'Signed in as' })).toBeNull()
  })

  it('heads the Settings sidebar with who is signed in, in place of the menu', async () => {
    answer('me/get', meAs())
    renderApp('/app/settings')
    const person = await screen.findByRole('group', { name: 'Signed in as' })
    expect(person.closest('[data-sidebar="header"]')).not.toBeNull()
    expect(person).toHaveTextContent('L')
    expect(person).toHaveTextContent('Lucía Gómez')
    expect(person).toHaveTextContent('lucia@acme.com')
    expect(screen.queryByRole('button', { name: 'Workspace menu' })).toBeNull()
  })

  it('shows a blank name as the email local part', async () => {
    answer('me/get', meAs({ name: '  ' }))
    renderApp('/app/settings')
    expect(await screen.findByRole('group', { name: 'Signed in as' })).toHaveTextContent('lucia')
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

  it('opens the menu with the organizations, the theme and sign out', async () => {
    const { openMenu, menuButton } = await open()
    const menu = await openMenu()
    expect(menuButton).toHaveAttribute('aria-expanded', 'true')
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
    expect(destinations()).toEqual(['Home'])
  })

  it('marks where the person is in the sidebar', async () => {
    const { location, goTo } = await open()
    expect(sidebarLink('Home')).toHaveAttribute('aria-current', 'page')
    await goTo('All workspaces')
    expect(await screen.findByRole('heading', { level: 1, name: 'Workspaces' })).toBeInTheDocument()
    expect(location()).toBe('/app/workspaces')
    expect(sidebarLink('Home')).not.toHaveAttribute('aria-current')
  })

  it("swaps the sidebar for Settings' sections, sliding them in, and Back slides the app's in", async () => {
    const { location, user, goTo } = await open()
    expect(panel()).not.toHaveClass('animate-in')
    await goTo('Settings')

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
  ])(
    'reaches %s from the workspace menu, marking its section in the Settings sidebar',
    async (item, path, section) => {
      const { location, goTo } = await open()
      await goTo(item)
      expect(await screen.findByRole('heading', { level: 2, name: section })).toBeInTheDocument()
      expect(location()).toBe(path)
      const marked = within(settingsNav())
        .getAllByRole('link')
        .filter((link) => link.ariaCurrent)
      expect(marked.map((link) => link.textContent)).toEqual([section])
    },
  )

  it('opens straight on a settings section with its sidebar, without sliding it in', async () => {
    await open('/app/settings?section=teams')
    await screen.findByRole('heading', { level: 1, name: 'Settings' })
    expect(within(settingsNav()).getByRole('link', { name: 'Teams' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(panel()).not.toHaveClass('animate-in')
  })

  it('hides Workspaces from a role without workspace read, and sends it Home from there', async () => {
    const auditor = meAs({ role: 'auditor', permissions: { usage: ['read'] } })
    const { location } = await open('/app/workspaces', auditor)
    expect(await screen.findByRole('heading', { name: 'Hi, Lucía Gómez.' })).toBeInTheDocument()
    expect(location()).toBe('/app')
  })

  it('opens Home on the first workspace once the organization has one', async () => {
    answer('workspaces/get', DEALS)
    const { location, menuButton } = await open('/app', meAs(), [DEALS, RESEARCH])
    expect(await screen.findByRole('heading', { level: 1, name: 'Workspace' })).toBeInTheDocument()
    expect(location()).toBe(`/app/workspaces/${DEALS.id}`)
    await waitFor(() => expect(menuButton).toHaveTextContent('Deals'))
  })

  it('opens Home on the workspace last opened on this device', async () => {
    answer('workspaces/get', (input: unknown) =>
      (input as { id: string }).id === DEALS.id ? DEALS : RESEARCH,
    )
    const first = await open(`/app/workspaces/${RESEARCH.id}`, meAs(), [DEALS, RESEARCH])
    await waitFor(() => expect(first.menuButton).toHaveTextContent('Research'))
    first.unmount()

    const { location } = await open('/app', meAs(), [DEALS, RESEARCH])
    await waitFor(() => expect(location()).toBe(`/app/workspaces/${RESEARCH.id}`))
  })

  it('keeps the general Home for a role without workspace read, asking for no workspaces', async () => {
    const auditor = meAs({ role: 'auditor', permissions: { usage: ['read'] } })
    const { location, openMenu } = await open('/app', auditor, [DEALS])
    expect(await screen.findByRole('heading', { name: 'Hi, Lucía Gómez.' })).toBeInTheDocument()
    expect(location()).toBe('/app')
    const menu = await openMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'All workspaces' })).toBeNull()
  })

  it('names the open workspace in the sidebar, whose Home, Library and Artifacts are its own', async () => {
    answer('workspaces/get', DEALS)
    const home = `/app/workspaces/${DEALS.id}`
    const { location, menuButton, user } = await open(home, meAs(), [DEALS])
    expect(await screen.findByRole('heading', { level: 1, name: 'Workspace' })).toBeInTheDocument()
    await waitFor(() => expect(menuButton).toHaveTextContent('Deals'))
    expect(menuButton).toHaveTextContent('Acme')
    expect(destinations()).toEqual(['Home', 'Library', 'Artifacts', 'Tasks'])
    expect(sidebarLink('Home')).toHaveAttribute('href', home)
    expect(sidebarLink('Home')).toHaveAttribute('aria-current', 'page')

    await user.click(sidebarLink('Library'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
    expect(location()).toBe(`${home}/library`)
    expect(sidebarLink('Library')).toHaveAttribute('aria-current', 'page')
    expect(sidebarLink('Home')).not.toHaveAttribute('aria-current')
    expect(menuButton).toHaveTextContent('Deals')

    await user.click(sidebarLink('Artifacts'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Artifacts' })).toBeInTheDocument()
    expect(location()).toBe(`${home}/artifacts`)
    expect(sidebarLink('Artifacts')).toHaveAttribute('aria-current', 'page')
  })

  it('leaves Library out for a role without file read, and sends it to the workspace from there', async () => {
    answer('workspaces/get', DEALS)
    const viewer = meAs({ role: 'viewer', permissions: { workspace: ['read'] } })
    const { location } = await open(`/app/workspaces/${DEALS.id}/library`, viewer, [DEALS])
    expect(await screen.findByRole('heading', { level: 1, name: 'Workspace' })).toBeInTheDocument()
    expect(location()).toBe(`/app/workspaces/${DEALS.id}`)
    expect(destinations()).toEqual(['Home', 'Tasks'])
  })

  it('leaves Members and Billing out of the menu of a member', async () => {
    const { openMenu } = await open('/app', meAs({ role: 'member' }))
    const menu = await openMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Members' })).toBeNull()
    expect(within(menu).queryByRole('menuitem', { name: 'Billing' })).toBeNull()
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
      answer('workspaces/list', [])
      const { location } = renderApp('/app/workspaces')
      const user = userEvent.setup()
      const toggle = await screen.findByRole('button', { name: 'Show or hide navigation' })
      expect(screen.queryByRole('navigation', { name: 'Navigation' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Workspace menu' })).toBeNull()
      expect(toggle).toHaveAttribute('aria-expanded', 'false')

      await user.click(toggle)
      await user.click(
        within(
          await within(await screen.findByRole('dialog')).findByRole('navigation', {
            name: 'Navigation',
          }),
        ).getByRole('link', { name: 'Home' }),
      )

      expect(await screen.findByRole('heading', { name: 'Hi, Lucía Gómez.' })).toBeInTheDocument()
      expect(location()).toBe('/app')
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    } finally {
      window.innerWidth = width
    }
  })

  it('signs out to Sign in', async () => {
    signOut.mockResolvedValue({ data: { success: true }, error: null })
    const { openMenu, location, user, queryClient } = await open()
    answer('me/get', 401)
    await user.click(within(await openMenu()).getByRole('menuitem', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(location()).toBe('/signin')
    const cached = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data)
    expect(cached.filter((data) => data !== undefined && data !== null)).toEqual([])
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
      expect(screen.getByRole('button', { name: 'Workspace menu' })).toBeInTheDocument()
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
