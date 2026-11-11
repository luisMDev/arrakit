import type { Workspace } from '@arrakit/contract'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { pageOf, taskOf } from '#/components/tasks/fixtures'
import { answer, meAs, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { WorkspaceTasksPage } from './workspace-tasks-page'

setupTestApi()

const DEALS: Workspace = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Deals',
  description: 'Open pipeline',
  createdOn: '2026-11-02',
}

const renderPage = (me = meAs()) =>
  renderAt(<WorkspaceTasksPage workspaceId={DEALS.id} />, {
    url: `/app/workspaces/${DEALS.id}/tasks`,
    me,
  })

describe('WorkspaceTasksPage', () => {
  it("shows the workspace's own background work", async () => {
    answer('workspaces/get', DEALS)
    const listed = answer(
      'tasks/list',
      pageOf([taskOf({ label: 'Export', workspaceId: DEALS.id })]),
    )
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks' })).toBeInTheDocument()
    expect(
      screen.getByText('Background work in Deals, and how far along it is.'),
    ).toBeInTheDocument()
    expect(await screen.findByText('Background task · Export')).toBeInTheDocument()
    expect(listed).toEqual([{ input: { status: 'active', limit: 100, workspaceId: DEALS.id } }])
  })

  it('tells a member it shows the work they started there', async () => {
    answer('workspaces/get', DEALS)
    answer('tasks/list', pageOf([]))
    renderPage(meAs({ role: 'member' }))
    expect(
      await screen.findByText('Background work you started in Deals, and how far along it is.'),
    ).toBeInTheDocument()
  })

  it('asks for no tasks when the workspace cannot be loaded', async () => {
    quiet()
    answer('workspaces/get', [404, 'No such workspace in your organization.'])
    const listed = answer('tasks/list', pageOf([]))
    renderPage()
    expect(await screen.findByText('No such workspace in your organization.')).toBeInTheDocument()
    expect(listed).toEqual([])
  })
})
