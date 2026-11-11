import type { Workspace } from '@arrakit/contract'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { SidebarProvider } from '#/components/ui/sidebar'
import { orpc } from '#/lib/orpc'
import { answer, answerAuth, meAs, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { WorkspaceMenu } from './workspace-menu'

setupTestApi()

const ACME = meAs().organization!
const BIRCH = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Birch',
  slug: 'birch',
  plan: 'free' as const,
}
const DEALS: Workspace = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Deals',
  description: '',
  createdOn: '2026-11-02',
}
const RESEARCH: Workspace = {
  ...DEALS,
  id: '0f8fad5b-d9cb-469f-a165-708677289508',
  name: 'Research',
}

beforeEach(() => {
  answerAuth('organization/list-members', { members: [], total: 3 })
  answerAuth('organization/list', [ACME])
  answer('workspaces/list', [])
})

const renderMenu = ({
  workspace,
  me = meAs(),
  url = '/app',
}: { workspace?: Workspace; me?: ReturnType<typeof meAs>; url?: string } = {}) =>
  renderAt(
    <SidebarProvider>
      <WorkspaceMenu workspace={workspace} />
    </SidebarProvider>,
    { url, me },
  )

const button = () => screen.findByRole('button', { name: 'Workspace menu' })
const openMenu = async () => {
  await userEvent.click(await button())
  return screen.findByRole('menu')
}
const items = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent)
const group = (menu: HTMLElement, name: string) => within(menu).getByRole('group', { name })

describe('WorkspaceMenu', () => {
  it('names the open workspace over its organization and marks it in the menu', async () => {
    answer('workspaces/list', [DEALS, RESEARCH])
    renderMenu({ workspace: DEALS })

    expect(await button()).toHaveTextContent('Deals')
    expect(await button()).toHaveTextContent('Acme')
    const workspaces = group(await openMenu(), 'Workspaces')
    expect(await within(workspaces).findByRole('menuitemradio', { name: 'Deals' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(workspaces).getByRole('menuitemradio', { name: 'Research' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('names the organization and its plan outside a workspace, loading the lists only when opened', async () => {
    const listed = answer('workspaces/list', [DEALS])
    renderMenu()

    expect(await button()).toHaveTextContent('Acme')
    expect(await button()).toHaveTextContent('Team')
    expect(listed).toEqual([])
    const workspaces = group(await openMenu(), 'Workspaces')
    expect(await within(workspaces).findByRole('menuitemradio', { name: 'Deals' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('heads the menu with the organization, its plan and how many members it has', async () => {
    renderMenu()

    const menu = await openMenu()
    expect(menu).toHaveTextContent('Acme')
    await waitFor(() =>
      expect(menu.querySelector('[data-summary]')).toHaveTextContent('Team · 3 members'),
    )
  })

  it('lists the workspaces first, then the organizations, and the rest in one last section', async () => {
    answer('workspaces/list', [DEALS])
    answerAuth('organization/list', [ACME, BIRCH])
    renderMenu()

    const menu = await openMenu()
    await within(menu).findByRole('menuitemradio', { name: /Birch/ })
    await within(menu).findByRole('menuitemradio', { name: 'Deals' })
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['DDeals', 'AcmeTeam', 'BirchFree'])
    expect(items(menu)).toEqual([
      'New workspace',
      'All workspaces',
      'Create organization',
      'Settings',
      'Members',
      'Billing',
      'Theme',
      'Sign out',
    ])
    expect(menu).not.toHaveTextContent('lucia@acme.com')
    for (const [name, href] of [
      ['Settings', '/app/settings'],
      ['Members', '/app/settings?section=members'],
      ['Billing', '/app/settings?section=billing'],
      ['All workspaces', '/app/workspaces'],
    ] as const)
      expect(within(menu).getByRole('menuitem', { name })).toHaveAttribute('href', href)
  })

  it.each(['free', 'pro'] as const)('offers Upgrade to who manages billing on %s', async (plan) => {
    renderMenu({ me: meAs({ plan }) })

    expect(within(await openMenu()).getByRole('menuitem', { name: 'Upgrade' })).toHaveAttribute(
      'href',
      '/app/plans',
    )
  })

  it('shows a member no Upgrade, Members or Billing', async () => {
    answer('workspaces/list', [DEALS])
    renderMenu({ me: meAs({ role: 'member', plan: 'free' }) })

    const menu = await openMenu()
    await within(menu).findByRole('menuitemradio', { name: 'Deals' })
    expect(items(menu)).toEqual([
      'New workspace',
      'All workspaces',
      'Create organization',
      'Settings',
      'Theme',
      'Sign out',
    ])
  })

  it('opens the workspace picked in the menu', async () => {
    answer('workspaces/list', [DEALS, RESEARCH])
    const { location } = renderMenu({ workspace: DEALS })

    const menu = await openMenu()
    await userEvent.click(await within(menu).findByRole('menuitemradio', { name: 'Research' }))
    await waitFor(() => expect(location()).toBe(`/app/workspaces/${RESEARCH.id}`))
  })

  it('says when there are no workspaces yet', async () => {
    renderMenu()

    expect(await within(await openMenu()).findByText('No workspaces yet.')).toBeInTheDocument()
  })

  it('creates a workspace and opens it', async () => {
    const created = answer('workspaces/create', RESEARCH)
    const { location } = renderMenu()

    await userEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'New workspace' }))
    const dialog = await screen.findByRole('dialog', { name: 'New workspace' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Research')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create workspace' }))

    expect(await screen.findByText('Research created.')).toBeInTheDocument()
    expect(created).toEqual([{ input: { name: 'Research', description: '' } }])
    await waitFor(() => expect(location()).toBe(`/app/workspaces/${RESEARCH.id}`))
  })

  it('leaves New workspace out for a role that cannot create', async () => {
    answer('workspaces/list', [DEALS])
    renderMenu({ me: meAs({ role: 'viewer', permissions: { workspace: ['read'] } }) })

    const menu = await openMenu()
    await within(menu).findByRole('menuitemradio', { name: 'Deals' })
    expect(within(menu).queryByRole('menuitem', { name: 'New workspace' })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: 'All workspaces' })).toBeInTheDocument()
  })

  it('shows a role without workspace read no workspaces, asking for none', async () => {
    const listed = answer('workspaces/list', [DEALS])
    renderMenu({ me: meAs({ role: 'auditor', permissions: { usage: ['read'] } }) })

    expect(items(await openMenu())).toEqual([
      'Create organization',
      'Settings',
      'Theme',
      'Sign out',
    ])
    expect(listed).toEqual([])
  })

  it('switches organization, reloads the screens and opens the app', async () => {
    answerAuth('organization/list', [ACME, BIRCH])
    const activated = answerAuth('organization/set-active', BIRCH)
    const loads = answer('me/get', meAs({ organization: BIRCH, plan: 'free' }))
    const { location, queryClient } = renderMenu({ url: '/app/settings' })
    const opened = await openMenu()
    await userEvent.click(await within(opened).findByRole('menuitemradio', { name: /Birch/ }))
    await waitFor(() => expect(location()).toBe('/app'))
    expect(activated).toEqual([{ input: { organizationId: BIRCH.id } }])
    expect(loads.length).toBeGreaterThan(0)
    await waitFor(() =>
      expect(queryClient.getQueryData(orpc.me.get.queryOptions().queryKey)).toMatchObject({
        organization: { name: 'Birch' },
      }),
    )
  })

  it('keeps the person loaded while the switch reloads them', async () => {
    answerAuth('organization/list', [ACME, BIRCH])
    answerAuth('organization/set-active', BIRCH)
    answer('me/get', async () => {
      await new Promise((r) => setTimeout(r, 30))
      return meAs({ organization: BIRCH, plan: 'free' })
    })
    const { queryClient } = renderMenu({ url: '/app/settings' })
    const { queryKey } = orpc.me.get.queryOptions()
    const missing: unknown[] = []
    queryClient.getQueryCache().subscribe(() => {
      if (queryClient.getQueryData(queryKey) === undefined) missing.push(queryKey)
    })
    const opened = await openMenu()
    await userEvent.click(await within(opened).findByRole('menuitemradio', { name: /Birch/ }))
    await waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toMatchObject({ organization: { name: 'Birch' } }),
    )
    expect(missing).toEqual([])
  })

  it('keeps the screen and toasts when the person does not reload after a switch', async () => {
    quiet()
    answerAuth('organization/list', [ACME, BIRCH])
    answerAuth('organization/set-active', BIRCH)
    answer('me/get', 500)
    renderMenu({ url: '/app/settings' })
    const opened = await openMenu()
    await userEvent.click(await within(opened).findByRole('menuitemradio', { name: /Birch/ }))
    expect(await screen.findByText("Couldn't switch organizations. Try again.")).toBeInTheDocument()
    expect(await button()).toHaveTextContent('Acme')
  })

  it('toasts a failed switch', async () => {
    quiet()
    answerAuth('organization/list', [ACME, BIRCH])
    answerAuth('organization/set-active', 500)
    renderMenu()
    const opened = await openMenu()
    await userEvent.click(await within(opened).findByRole('menuitemradio', { name: /Birch/ }))
    expect(await screen.findByText("Couldn't switch organizations. Try again.")).toBeInTheDocument()
  })

  it('creates an organization, which Better Auth makes active, and opens the app', async () => {
    const created = answerAuth('organization/create', async () => {
      await new Promise((r) => setTimeout(r, 30))
      return { ...BIRCH, name: 'Birch Labs', members: [] }
    })
    const activated = answerAuth('organization/set-active', BIRCH)
    answer('me/get', meAs({ organization: BIRCH, plan: 'free' }))
    const { location } = renderMenu({ url: '/app/settings' })
    const opened = await openMenu()
    await userEvent.click(within(opened).getByRole('menuitem', { name: 'Create organization' }))
    const form = await screen.findByRole('dialog', { name: 'Create an organization' })
    await userEvent.click(within(form).getByRole('button', { name: 'Create' }))
    expect(await within(form).findByText("Enter the organization's name.")).toBeInTheDocument()
    await userEvent.type(within(form).getByLabelText('Organization name'), ' Birch Labs ')
    await userEvent.dblClick(within(form).getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Birch Labs is ready.')).toBeInTheDocument()
    await waitFor(() => expect(location()).toBe('/app'))
    expect(created).toEqual([{ input: { name: 'Birch Labs', slug: 'pending' } }])
    expect(activated).toEqual([])
  })

  it('toasts a failed create and keeps the dialog open', async () => {
    quiet()
    answerAuth('organization/create', 500)
    renderMenu()
    const opened = await openMenu()
    await userEvent.click(within(opened).getByRole('menuitem', { name: 'Create organization' }))
    const form = await screen.findByRole('dialog')
    await userEvent.type(within(form).getByLabelText('Organization name'), 'Birch')
    await userEvent.click(within(form).getByRole('button', { name: 'Create' }))
    expect(
      await screen.findByText("Couldn't create the organization. Try again."),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
