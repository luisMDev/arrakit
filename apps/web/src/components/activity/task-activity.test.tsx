import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { answer, renderAt, setupTestApi } from '#/test/rpc'

import { pageOf, taskOf } from './fixtures'
import { TaskActivity } from './task-activity'

setupTestApi()

const DEALS = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const workspaces = [{ id: DEALS, name: 'Deals', description: '', createdOn: '2026-11-01' }]

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

describe('TaskActivity', () => {
  it('lists the tasks in progress with their status, progress and who started them', async () => {
    answer('workspaces/list', workspaces)
    answer(
      'tasks/list',
      pageOf([
        taskOf({ label: 'Deals', status: 'running', progress: { done: 1, total: 2 } }),
        taskOf({ label: 'Leads', status: 'running', requestedByYou: false, requesterName: 'Ana' }),
        taskOf({
          label: 'Old',
          status: 'queued',
          attempts: 1,
          requestedByYou: false,
          requesterName: null,
        }),
      ]),
    )
    renderAt(<TaskActivity />)

    const table = await screen.findByRole('table', { name: 'In progress' })
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    const deals = rowOf('Background task · Deals')
    expect(within(deals).getByText('Running')).toBeInTheDocument()
    expect(
      within(deals).getByRole('progressbar', { name: 'Background task · Deals: 50% done' }),
    ).toBeInTheDocument()
    expect(within(deals).getByText('You')).toBeInTheDocument()

    const leads = rowOf('Background task · Leads')
    expect(within(leads).getByText('Working')).toBeInTheDocument()
    expect(within(leads).getByText('Ana')).toBeInTheDocument()
    const old = rowOf('Background task · Old')
    expect(within(old).getByText('Retrying (2 of 3)')).toBeInTheDocument()
    expect(within(old).getByText('—')).toBeInTheDocument()
  })

  it('says where each task of the organization runs: a workspace, or the organization itself', async () => {
    answer('workspaces/list', workspaces)
    const calls = answer(
      'tasks/list',
      pageOf([taskOf({ label: 'Export', workspaceId: DEALS }), taskOf({ label: 'Invoices' })]),
    )
    renderAt(<TaskActivity />)

    expect(await screen.findByRole('columnheader', { name: 'Where' })).toBeInTheDocument()
    expect(await within(rowOf('Background task · Export')).findByText('Deals')).toBeInTheDocument()
    expect(
      within(rowOf('Background task · Invoices')).getByText('Organization'),
    ).toBeInTheDocument()
    expect(calls[0]!.input).toEqual({ status: 'active', limit: 100 })
  })

  it("keeps to one workspace's tasks, without saying where they run", async () => {
    const calls = answer('tasks/list', pageOf([taskOf({ label: 'Export', workspaceId: DEALS })]))
    renderAt(<TaskActivity workspaceId={DEALS} />)

    await screen.findByText('Background task · Export')
    expect(screen.queryByRole('columnheader', { name: 'Where' })).toBeNull()
    expect(calls[0]!.input).toEqual({ status: 'active', limit: 100, workspaceId: DEALS })
  })

  it('says when nothing is running', async () => {
    answer('tasks/list', pageOf([]))
    renderAt(<TaskActivity workspaceId={DEALS} />)
    expect(await screen.findByText('Nothing is running right now.')).toBeInTheDocument()
  })

  it('shows finished tasks with why they failed, a page at a time', async () => {
    const calls = answer(
      'tasks/list',
      pageOf([]),
      pageOf(
        [
          taskOf({
            label: 'Deals',
            status: 'failed',
            errorCode: 'stalled',
            finishedAt: '2026-11-11T10:00:00.000Z',
          }),
        ],
        'cursor-1',
      ),
      pageOf([taskOf({ label: 'Leads', status: 'succeeded', progress: { done: 3, total: 3 } })]),
    )
    renderAt(<TaskActivity workspaceId={DEALS} />)
    const user = userEvent.setup()
    await screen.findByText('Nothing is running right now.')
    await user.click(screen.getByRole('tab', { name: 'Finished' }))

    const deals = await screen.findByText('Background task · Deals')
    expect(within(deals.closest('tr')!).getByText('Failed')).toBeInTheDocument()
    expect(
      within(deals.closest('tr')!).getByText('The task stopped responding.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('Background task · Leads')).toBeInTheDocument()
    expect(within(rowOf('Background task · Leads')).getByText('Done')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
    expect(calls.slice(1).map(({ input }) => input)).toEqual([
      { status: 'finished', limit: 50, workspaceId: DEALS },
      { status: 'finished', after: 'cursor-1', limit: 50, workspaceId: DEALS },
    ])
  })
})
