import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { answer, meAs, renderAt, setupTestApi } from '#/test/rpc'

import { ActivityPage, type ActivityTab } from './activity-page'
import { pageOf, taskOf } from './fixtures'

setupTestApi()

function openActivity(url = '/app/activity', me = meAs()) {
  return renderAt((search) => <ActivityPage tab={search.tab as ActivityTab | undefined} />, {
    url,
    me,
  })
}

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

describe('Activity', () => {
  it('lists the tasks in progress with their status, progress and who started them', async () => {
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
    openActivity()

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

  it('says whose work it shows: all of it for a role that reads tasks, else your own', async () => {
    answer('tasks/list', pageOf([]))
    const { unmount } = openActivity()
    expect(
      await screen.findByText('Work that runs in the background in Acme, and how far along it is.'),
    ).toBeInTheDocument()
    unmount()

    openActivity('/app/activity', meAs({ role: 'member' }))
    expect(
      await screen.findByText(
        'Work you started that runs in the background, and how far along it is.',
      ),
    ).toBeInTheDocument()
  })

  it('says when nothing is running', async () => {
    answer('tasks/list', pageOf([]))
    openActivity()
    expect(await screen.findByText('Nothing is running right now.')).toBeInTheDocument()
  })

  it('shows finished tasks with why they failed, a page at a time', async () => {
    const calls = answer(
      'tasks/list',
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
    openActivity('/app/activity?tab=finished')

    const deals = await screen.findByText('Background task · Deals')
    expect(within(deals.closest('tr')!).getByText('Failed')).toBeInTheDocument()
    expect(
      within(deals.closest('tr')!).getByText('The task stopped responding.'),
    ).toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('Background task · Leads')).toBeInTheDocument()
    expect(within(rowOf('Background task · Leads')).getByText('Done')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
    expect(calls.map(({ input }) => input)).toEqual([
      { status: 'finished', limit: 50 },
      { status: 'finished', after: 'cursor-1', limit: 50 },
    ])
  })

  it('opens a tab from the address and keeps the tab chosen in it', async () => {
    answer('tasks/list', pageOf([]))
    const { router } = openActivity()
    await screen.findByText('Nothing is running right now.')

    await userEvent.setup().click(screen.getByRole('tab', { name: 'Finished' }))
    expect(await screen.findByText('Nothing has finished yet.')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'finished' }))
  })
})
