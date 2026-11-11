import type { Workspace } from '@arrakit/contract'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { answer, meAs, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { WorkspacePage } from './workspace-page'

setupTestApi()

const DEALS: Workspace = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Deals',
  description: 'Open pipeline',
  createdOn: '2026-11-02',
}

const renderPage = (permissions?: Record<string, string[]>) =>
  renderAt(<WorkspacePage workspaceId={DEALS.id} />, {
    url: `/app/workspaces/${DEALS.id}`,
    me: meAs(permissions ? { role: 'custom', permissions } : {}),
  })

describe('WorkspacePage', () => {
  it("is the workspace's Home: its name, what it is for and the way to its library", async () => {
    const asked = answer('workspaces/get', DEALS)
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Deals' })).toBeInTheDocument()
    expect(screen.getByText('Open pipeline')).toBeInTheDocument()
    expect(screen.getByText(/A workspace of Acme\./)).toBeInTheDocument()
    expect(asked).toEqual([{ input: { id: DEALS.id } }])
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute(
      'href',
      `/app/workspaces/${DEALS.id}/library`,
    )
  })

  it('leaves the library out for a role without file read', async () => {
    answer('workspaces/get', DEALS)
    renderPage({ workspace: ['read'] })

    await screen.findByRole('heading', { level: 1, name: 'Deals' })
    expect(screen.queryByRole('link', { name: 'Library' })).toBeNull()
  })

  it('says why a workspace could not be loaded, and shows nothing of it', async () => {
    quiet()
    answer('workspaces/get', [404, 'No such workspace in your organization.'])
    renderPage()
    expect(await screen.findByText('No such workspace in your organization.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })
})
