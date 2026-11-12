import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SidebarProvider } from '#/components/ui/sidebar'
import { TooltipProvider } from '#/components/ui/tooltip'
import { setupFakeRealtime } from '#/test/realtime'
import { answer, renderAt, setupTestApi } from '#/test/rpc'

import { TasksIndicator } from './tasks-indicator'
import { pageOf, taskOf } from './fixtures'

vi.mock('#/lib/realtime', async () => (await import('#/test/realtime')).fakeRealtime)

setupTestApi()
const joins = setupFakeRealtime()

function openApp() {
  return renderAt(
    <TooltipProvider>
      <SidebarProvider>
        <TasksIndicator />
      </SidebarProvider>
    </TooltipProvider>,
    { url: '/app' },
  )
}

describe('Tasks indicator', () => {
  it('stays out of the way while nothing runs, and joins no channel', async () => {
    const lists = answer('tasks/list', pageOf([]))
    openApp()
    await waitFor(() => expect(lists).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('button', { name: /in progress/ })).toBeNull()
    expect(joins).toHaveLength(0)
  })

  it('counts the tasks in progress and shows how far along the first ones are', async () => {
    answer(
      'tasks/list',
      pageOf([
        taskOf({ label: 'Deals', status: 'running', progress: { done: 3, total: 4 } }),
        taskOf({ label: 'Leads' }),
      ]),
    )
    openApp()

    const button = await screen.findByRole('button', { name: '2 tasks in progress' })
    await userEvent.setup().click(button)
    const list = await screen.findByRole('list', { name: '2 tasks in progress' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(
      within(list).getByRole('progressbar', { name: 'Background task · Deals: 75% done' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View all tasks' })).toHaveAttribute(
      'href',
      '/app/settings?section=tasks',
    )
  })

  it('tells the person when a task they started finishes, keeps quiet about others, and goes once none runs', async () => {
    const mine = taskOf({ label: 'Deals', status: 'running' })
    const theirs = taskOf({ label: 'Leads', status: 'running', requestedByYou: false })
    const failing = taskOf({ label: 'Pipeline', status: 'running' })
    answer('tasks/list', pageOf([mine, theirs, failing]))
    const now = new Map([
      [theirs.id, { ...theirs, status: 'succeeded' }],
      [mine.id, { ...mine, status: 'succeeded' }],
      [failing.id, { ...failing, status: 'failed', errorCode: 'stalled' }],
    ])
    answer('tasks/get', (input: unknown) => now.get((input as { id: string }).id))
    openApp()
    await screen.findByRole('button', { name: '3 tasks in progress' })
    await waitFor(() => expect(joins).toHaveLength(1))

    for (const task of [theirs, mine, failing]) joins[0]!.message({ taskId: task.id })

    expect(await screen.findByText('Background task · Deals is done.')).toBeInTheDocument()
    expect(await screen.findByText('Background task · Pipeline failed.')).toBeInTheDocument()
    expect(screen.getByText('The task stopped responding.')).toBeInTheDocument()
    expect(screen.queryByText('Background task · Leads is done.')).toBeNull()
    await waitFor(() => expect(screen.queryByRole('button', { name: /in progress/ })).toBeNull())
  })
})
