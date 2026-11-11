import type { TaskPage, TaskView } from '@arrakit/contract'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { orpc } from '#/lib/orpc'
import { answer, answerStream, setupTestApi, testQueryClient } from '#/test/rpc'

import { pageOf, taskOf } from './fixtures'
import {
  FALLBACK_AFTER_FAILURES,
  activeTasksQuery,
  applyTaskChange,
  useTaskWatch,
} from './use-tasks'

setupTestApi()

const WORKSPACE = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const activeKey = activeTasksQuery().queryKey
const workspaceKey = orpc.tasks.list.queryKey({
  input: { status: 'active', workspaceId: WORKSPACE, limit: 100 },
})
const idsIn = (page: TaskPage | undefined) => page?.tasks.map((task) => task.id)

describe('applyTaskChange', () => {
  it('puts a new active task at the top and replaces one already listed', () => {
    const queryClient = testQueryClient()
    const old = taskOf()
    queryClient.setQueryData(activeKey, pageOf([old]))

    const created = taskOf()
    expect(applyTaskChange(queryClient, created)).toBe(false)
    expect(idsIn(queryClient.getQueryData(activeKey))).toEqual([created.id, old.id])

    const running = { ...old, status: 'running' as const }
    applyTaskChange(queryClient, running)
    expect(queryClient.getQueryData<TaskPage>(activeKey)?.tasks[1]).toEqual(running)
    expect(queryClient.getQueryData(orpc.tasks.get.queryKey({ input: { id: old.id } }))).toEqual(
      running,
    )
  })

  it('takes a finished task out of the active lists, reads the finished ones again and says it finished', () => {
    const queryClient = testQueryClient()
    const task = taskOf({ status: 'running' })
    queryClient.setQueryData(activeKey, pageOf([task]))
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    expect(applyTaskChange(queryClient, { ...task, status: 'succeeded' })).toBe(true)
    expect(idsIn(queryClient.getQueryData(activeKey))).toEqual([])
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: orpc.tasks.list.key({ type: 'infinite' }),
    })
  })

  it('does not say a task finished when it was never listed as active', () => {
    const queryClient = testQueryClient()
    queryClient.setQueryData(activeKey, pageOf([]))
    expect(applyTaskChange(queryClient, taskOf({ status: 'failed' }))).toBe(false)
  })

  it('keeps a workspace list to its own workspace', () => {
    const queryClient = testQueryClient()
    queryClient.setQueryData(activeKey, pageOf([]))
    queryClient.setQueryData(workspaceKey, pageOf([]))

    const organizationWide = taskOf()
    const inWorkspace = taskOf({ workspaceId: WORKSPACE })
    applyTaskChange(queryClient, organizationWide)
    applyTaskChange(queryClient, inWorkspace)
    expect(idsIn(queryClient.getQueryData(workspaceKey))).toEqual([inWorkspace.id])
    expect(idsIn(queryClient.getQueryData(activeKey))).toEqual([
      inWorkspace.id,
      organizationWide.id,
    ])
  })
})

const FAST = { retryMs: [5], fallbackRefreshMs: 30 }

function Watching({
  enabled = true,
  onFinished,
}: {
  enabled?: boolean
  onFinished?: (task: TaskView) => void
}) {
  useTaskWatch(enabled, onFinished, FAST)
  return null
}

function watch(props: Parameters<typeof Watching>[0] = {}) {
  const queryClient = testQueryClient()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Watching {...props} />
    </QueryClientProvider>,
  )
  return { ...view, queryClient }
}

describe('useTaskWatch', () => {
  it('reads the lists again on resync, then keeps them current with each change', async () => {
    const streams = answerStream('tasks/watch')
    const task = taskOf()
    answer('tasks/list', pageOf([task]))
    const onFinished = vi.fn()
    const { queryClient } = watch({ onFinished })
    queryClient.setQueryData(activeKey, pageOf([task]))

    await waitFor(() => expect(streams).toHaveLength(1))
    streams[0]!.send({ type: 'resync' })
    await waitFor(() => expect(queryClient.getQueryState(activeKey)?.isInvalidated).toBe(true))

    streams[0]!.send({ type: 'task', task: { ...task, status: 'succeeded' } })
    await waitFor(() =>
      expect(onFinished).toHaveBeenCalledWith(expect.objectContaining({ id: task.id })),
    )
  })

  it('opens the stream again when it ends', async () => {
    const streams = answerStream('tasks/watch')
    watch()
    await waitFor(() => expect(streams).toHaveLength(1))
    streams[0]!.end()
    await waitFor(() => expect(streams).toHaveLength(2))
  })

  it('reads the lists on a timer after failing several times in a row, until a stream works', async () => {
    const watches = answer('tasks/watch', 503)
    const { queryClient } = watch()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await waitFor(() => expect(watches.length).toBeGreaterThan(FALLBACK_AFTER_FAILURES))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: orpc.tasks.key() }))
  })

  it('opens no stream while disabled, and one once enabled', async () => {
    const streams = answerStream('tasks/watch')
    const { rerender, queryClient } = watch({ enabled: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(streams).toHaveLength(0)

    rerender(
      <QueryClientProvider client={queryClient}>
        <Watching enabled />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(streams).toHaveLength(1))
  })

  it('closes the stream while the page is hidden and opens one when it shows again', async () => {
    const streams = answerStream('tasks/watch')
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    watch()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(streams).toHaveLength(0)

    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(streams).toHaveLength(1))
  })
})
