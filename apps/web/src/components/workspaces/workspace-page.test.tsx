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
  it('shows the workspace and its files', async () => {
    const asked = answer('workspaces/get', DEALS)
    const listed = answer('files/list', [])
    answer('files/policy', { maxBytes: 1_000_000, extensions: ['pdf'] })
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Deals' })).toBeInTheDocument()
    expect(screen.getByText('Open pipeline')).toBeInTheDocument()
    expect(await screen.findByText('No files yet.')).toBeInTheDocument()
    expect(asked).toEqual([{ input: { id: DEALS.id } }])
    expect(listed).toEqual([{ input: { workspaceId: DEALS.id } }])
    expect(screen.getByRole('link', { name: 'All workspaces' })).toHaveAttribute(
      'href',
      '/app/workspaces',
    )
  })

  it('leaves the files out for a role without file read', async () => {
    answer('workspaces/get', DEALS)
    const listed = answer('files/list', [])
    renderPage({ workspace: ['read'] })

    await screen.findByRole('heading', { level: 1, name: 'Deals' })
    expect(screen.queryByRole('heading', { name: 'Files' })).toBeNull()
    expect(listed).toEqual([])
  })

  it('says why a workspace could not be loaded, and shows nothing of it', async () => {
    quiet()
    answer('workspaces/get', [404, 'No such workspace in your organization.'])
    renderPage()
    expect(await screen.findByText('No such workspace in your organization.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })
})
