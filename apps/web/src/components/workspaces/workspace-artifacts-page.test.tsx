import type { Workspace } from '@arrakit/contract'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { answer, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { WorkspaceArtifactsPage } from './workspace-artifacts-page'

setupTestApi()

const DEALS: Workspace = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Deals',
  description: 'Open pipeline',
  createdOn: '2026-11-02',
}

const renderPage = () =>
  renderAt(<WorkspaceArtifactsPage workspaceId={DEALS.id} />, {
    url: `/app/workspaces/${DEALS.id}/artifacts`,
  })

describe('WorkspaceArtifactsPage', () => {
  it("shows the workspace's own artifacts", async () => {
    answer('workspaces/get', DEALS)
    const listed = answer('artifacts/list', [])
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Artifacts' })).toBeInTheDocument()
    expect(screen.getByText(/^Reports in HTML or Markdown published to Deals/)).toBeInTheDocument()
    expect(await screen.findByText('No artifacts yet.')).toBeInTheDocument()
    expect(listed).toEqual([{ input: { workspaceId: DEALS.id } }])
  })

  it('says why a workspace could not be loaded, asking for no artifacts', async () => {
    quiet()
    answer('workspaces/get', [404, 'No such workspace in your organization.'])
    const listed = answer('artifacts/list', [])
    renderPage()
    expect(await screen.findByText('No such workspace in your organization.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(listed).toEqual([])
  })
})
