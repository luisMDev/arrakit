import type { Workspace } from '@arrakit/contract'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { answer, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { WorkspaceLibraryPage } from './workspace-library-page'

setupTestApi()

const DEALS: Workspace = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Deals',
  description: 'Open pipeline',
  createdOn: '2026-11-02',
}

const renderPage = () =>
  renderAt(<WorkspaceLibraryPage workspaceId={DEALS.id} />, {
    url: `/app/workspaces/${DEALS.id}/library`,
  })

describe('WorkspaceLibraryPage', () => {
  it("shows the workspace's own files", async () => {
    answer('workspaces/get', DEALS)
    const listed = answer('files/list', [])
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
    expect(screen.getByText('Files shared in Deals.')).toBeInTheDocument()
    expect(await screen.findByText('No files yet.')).toBeInTheDocument()
    expect(listed).toEqual([{ input: { workspaceId: DEALS.id } }])
  })

  it('says why a workspace could not be loaded, asking for no files', async () => {
    quiet()
    answer('workspaces/get', [404, 'No such workspace in your organization.'])
    const listed = answer('files/list', [])
    renderPage()
    expect(await screen.findByText('No such workspace in your organization.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(listed).toEqual([])
  })
})
