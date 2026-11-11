import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { SidebarProvider } from '#/components/ui/sidebar'
import { TooltipProvider } from '#/components/ui/tooltip'
import { answer, answerStream, renderAt, setupTestApi } from '#/test/rpc'

import { ActivityIndicator } from './activity-indicator'
import { pageOf, taskOf } from './fixtures'

setupTestApi()

function openApp() {
  return renderAt(
    <TooltipProvider>
      <SidebarProvider>
        <ActivityIndicator />
      </SidebarProvider>
    </TooltipProvider>,
    { url: '/app' },
  )
}

describe('Activity indicator', () => {
  it('stays out of the way while nothing runs, and opens no stream', async () => {
    const lists = answer('tasks/list', pageOf([]))
    const streams = answerStream('tasks/watch')
    openApp()
    await waitFor(() => expect(lists).toHaveLength(1))
    expect(screen.queryByRole('button', { name: /in progress/ })).toBeNull()
    expect(streams).toHaveLength(0)
  })

  it('counts the tasks in progress and shows how far along the first ones are', async () => {
    answer(
      'tasks/list',
      pageOf([
        taskOf({ label: 'Deals', status: 'running', progress: { done: 3, total: 4 } }),
        taskOf({ label: 'Leads' }),
      ]),
    )
    answerStream('tasks/watch')
    openApp()

    const button = await screen.findByRole('button', { name: '2 tasks in progress' })
    await userEvent.setup().click(button)
    const list = await screen.findByRole('list', { name: '2 tasks in progress' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(
      within(list).getByRole('progressbar', { name: 'Background task · Deals: 75% done' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View all activity' })).toHaveAttribute(
      'href',
      '/app/settings?section=activity',
    )
  })

  it('tells the person when a task they started finishes, keeps quiet about others, and goes once none runs', async () => {
    const mine = taskOf({ label: 'Deals', status: 'running' })
    const theirs = taskOf({ label: 'Leads', status: 'running', requestedByYou: false })
    const failing = taskOf({ label: 'Pipeline', status: 'running' })
    answer('tasks/list', pageOf([mine, theirs, failing]))
    const streams = answerStream('tasks/watch')
    openApp()
    await screen.findByRole('button', { name: '3 tasks in progress' })
    await waitFor(() => expect(streams).toHaveLength(1))

    streams[0]!.send({ type: 'task', task: { ...theirs, status: 'succeeded' } })
    streams[0]!.send({ type: 'task', task: { ...mine, status: 'succeeded' } })
    streams[0]!.send({
      type: 'task',
      task: { ...failing, status: 'failed', errorCode: 'stalled' },
    })

    expect(await screen.findByText('Background task · Deals is done.')).toBeInTheDocument()
    expect(await screen.findByText('Background task · Pipeline failed.')).toBeInTheDocument()
    expect(screen.getByText('The task stopped responding.')).toBeInTheDocument()
    expect(screen.queryByText('Background task · Leads is done.')).toBeNull()
    await waitFor(() => expect(screen.queryByRole('button', { name: /in progress/ })).toBeNull())
  })
})
