import type { Workspace } from '@arrakit/contract'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { answer, meAs, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { WorkspacesPage } from './workspaces-page'

setupTestApi()

const workspace = (name: string, overrides: Partial<Workspace> = {}): Workspace => ({
  id: `0f8fad5b-d9cb-469f-a165-7086772895${String(name.length).padStart(2, '0')}`,
  name,
  description: '',
  createdOn: '2026-11-02',
  ...overrides,
})

const MARKETING = workspace('Marketing', { description: 'Campaigns and launches' })

const renderPage = (role = 'owner', permissions?: ReturnType<typeof meAs>['permissions']) =>
  renderAt(<WorkspacesPage />, {
    url: '/app/workspaces',
    me: meAs({ role, ...(permissions ? { permissions } : {}) }),
  })

const card = (name: string) => document.querySelector<HTMLElement>(`[data-workspace="${name}"]`)!

describe('WorkspacesPage', () => {
  it('lists the workspaces with their description and day', async () => {
    answer('workspaces/list', [MARKETING, workspace('Sales')])
    renderPage()
    const list = await screen.findByRole('list', { name: 'Workspaces' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(card('Marketing')).toHaveTextContent('Campaigns and launches')
    expect(card('Marketing')).toHaveTextContent('Created Nov 2, 2026')
    expect(screen.getByText(/Everyone in Acme sees its workspaces/)).toBeInTheDocument()
  })

  it('says when there are none yet', async () => {
    answer('workspaces/list', [])
    renderPage()
    expect(await screen.findByText('No workspaces yet.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Workspaces' })).toBeNull()
  })

  it('lets a member create but not edit or delete', async () => {
    answer('workspaces/list', [MARKETING])
    renderPage('member')
    await screen.findByText('Marketing')
    expect(screen.getByRole('button', { name: 'New workspace' })).toBeInTheDocument()
    expect(within(card('Marketing')).queryByRole('button')).toBeNull()
  })

  it('shows a role with read only the list', async () => {
    answer('workspaces/list', [MARKETING])
    renderPage('viewer', { workspace: ['read'] })
    await screen.findByText('Marketing')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('creates a workspace once, validating the form first', async () => {
    const created = answer('workspaces/create', async (input: unknown) => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return workspace('Research', input as Partial<Workspace>)
    })
    answer('workspaces/list', [], [workspace('Research', { description: 'Studies' })])
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New workspace' }))
    const dialog = await screen.findByRole('dialog', { name: 'New workspace' })

    await user.click(within(dialog).getByRole('button', { name: 'Create workspace' }))
    expect(await within(dialog).findByText("Enter the workspace's name.")).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Name'), '  Research ')
    expect(within(dialog).queryByText("Enter the workspace's name.")).toBeNull()
    await user.type(within(dialog).getByLabelText('Description'), 'Studies')
    await user.dblClick(within(dialog).getByRole('button', { name: 'Create workspace' }))

    expect(await screen.findByText('Research created.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByText('Studies')).toBeInTheDocument()
    expect(created).toEqual([{ input: { name: 'Research', description: 'Studies' } }])
  })

  it('refuses a name over the limit before calling the API', async () => {
    const created = answer('workspaces/create', MARKETING)
    answer('workspaces/list', [])
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New workspace' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByLabelText('Name'))
    await user.paste('x'.repeat(101))
    await user.click(within(dialog).getByRole('button', { name: 'Create workspace' }))
    expect(
      await within(dialog).findByText('Keep the name under 100 characters.'),
    ).toBeInTheDocument()
    expect(created).toEqual([])
  })

  it("toasts the API's reason when the name is taken, keeping the dialog open", async () => {
    quiet()
    answer('workspaces/create', [409, 'A workspace named Marketing already exists.'])
    answer('workspaces/list', [MARKETING])
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New workspace' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'marketing')
    await user.click(within(dialog).getByRole('button', { name: 'Create workspace' }))
    expect(
      await screen.findByText('A workspace named Marketing already exists.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('edits a workspace from its card', async () => {
    const updated = answer('workspaces/update', {
      ...MARKETING,
      name: 'Growth',
      description: 'Campaigns and launches',
    })
    answer('workspaces/list', [MARKETING], [{ ...MARKETING, name: 'Growth' }])
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Edit Marketing' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit workspace' })
    const name = within(dialog).getByLabelText('Name')
    expect(name).toHaveValue('Marketing')
    expect(within(dialog).getByLabelText('Description')).toHaveValue('Campaigns and launches')
    await user.clear(name)
    await user.type(name, 'Growth')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Growth saved.')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('[data-workspace="Growth"]')).not.toBeNull())
    expect(document.querySelector('[data-workspace="Marketing"]')).toBeNull()
    expect(updated).toEqual([
      { input: { id: MARKETING.id, name: 'Growth', description: 'Campaigns and launches' } },
    ])
  })

  it('deletes a workspace after confirming', async () => {
    const deleted = answer('workspaces/delete', null)
    answer('workspaces/list', [MARKETING], [])
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Delete Marketing' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Marketing?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Marketing deleted.')).toBeInTheDocument()
    expect(await screen.findByText('No workspaces yet.')).toBeInTheDocument()
    expect(deleted).toEqual([{ input: { id: MARKETING.id } }])
  })

  it('says when the workspaces could not load', async () => {
    quiet()
    answer('workspaces/list', 500)
    renderPage()
    expect(
      await screen.findByText("Couldn't load the workspaces. Reload the page."),
    ).toBeInTheDocument()
  })
})
