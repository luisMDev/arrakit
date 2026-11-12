import { TASK_SIGNAL_EVENT, type TaskPage, type TaskView } from '@arrakit/contract'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Toaster } from '#/components/ui/sonner'
import { orpc } from '#/lib/orpc'
import { FAKE_TOPICS, setupFakeRealtime } from '#/test/realtime'
import { answer, setupTestApi, testQueryClient } from '#/test/rpc'

import { pageOf, taskOf } from './fixtures'
import {
  FALLBACK_AFTER_FAILURES,
  activeTasksQuery,
  applyTaskChange,
  useTaskWatch,
} from './use-tasks'

vi.mock('#/lib/realtime', async () => (await import('#/test/realtime')).fakeRealtime)

setupTestApi()
const joins = setupFakeRealtime()

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
const ORGANIZATION = '0f8fad5b-d9cb-469f-a165-70867728950e'
const OTHER_ORGANIZATION = '6ba7b810-9dad-41d1-80b4-00c04fd430c8'

function Watching({
  organizationId = ORGANIZATION,
  onFinished,
}: {
  organizationId?: string | null
  onFinished?: (task: TaskView) => void
}) {
  useTaskWatch(organizationId, onFinished, FAST)
  return null
}

function watch(props: Parameters<typeof Watching>[0] = {}) {
  const queryClient = testQueryClient()
  const ui = (next: Parameters<typeof Watching>[0]) => (
    <QueryClientProvider client={queryClient}>
      <Watching {...next} />
      <Toaster />
    </QueryClientProvider>
  )
  const view = render(ui(props))
  return {
    queryClient,
    rerender: (next: Parameters<typeof Watching>[0]) => view.rerender(ui(next)),
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('useTaskWatch', () => {
  it('joins the task channel and reads the lists again once it is joined', async () => {
    const { queryClient } = watch()
    queryClient.setQueryData(activeKey, pageOf([]))

    await waitFor(() => expect(joins).toHaveLength(1))
    expect(joins[0]).toMatchObject({ topic: FAKE_TOPICS.tasks, event: TASK_SIGNAL_EVENT })
    expect(queryClient.getQueryState(activeKey)?.isInvalidated).toBe(false)
    joins[0]!.subscribed()
    await waitFor(() => expect(queryClient.getQueryState(activeKey)?.isInvalidated).toBe(true))
  })

  it('reads a signalled task through the API, puts it in the lists and says when it finishes', async () => {
    const task = taskOf({ status: 'running' })
    const reads = answer('tasks/get', { ...task, status: 'succeeded' })
    const onFinished = vi.fn()
    const { queryClient } = watch({ onFinished })
    queryClient.setQueryData(activeKey, pageOf([task]))

    await waitFor(() => expect(joins).toHaveLength(1))
    joins[0]!.message({ taskId: task.id })
    await waitFor(() =>
      expect(onFinished).toHaveBeenCalledWith(expect.objectContaining({ id: task.id })),
    )
    expect(reads).toEqual([{ input: { id: task.id } }])
    expect(idsIn(queryClient.getQueryData(activeKey))).toEqual([])
  })

  it('ignores a signalled task the person may not see, and says nothing about it', async () => {
    const task = taskOf()
    const reads = answer('tasks/get', 404)
    const onFinished = vi.fn()
    const { queryClient } = watch({ onFinished })
    queryClient.setQueryData(activeKey, pageOf([]))

    await waitFor(() => expect(joins).toHaveLength(1))
    joins[0]!.message({ taskId: task.id })
    await waitFor(() => expect(reads).toHaveLength(1))
    await settle()
    expect(onFinished).not.toHaveBeenCalled()
    expect(idsIn(queryClient.getQueryData(activeKey))).toEqual([])
    expect(document.querySelector('[data-sonner-toast]')).toBeNull()
  })

  it('reads nothing for a signal it does not understand', async () => {
    const reads = answer('tasks/get', taskOf())
    watch()
    await waitFor(() => expect(joins).toHaveLength(1))
    joins[0]!.message({ taskId: 'not-a-uuid' })
    joins[0]!.message('task.changed')
    joins[0]!.message(null)
    await settle()
    expect(reads).toHaveLength(0)
  })

  it('reads a task signalled again while it is being read once more, after the first read', async () => {
    const task = taskOf()
    let release!: () => void
    const firstRead = new Promise<void>((resolve) => {
      release = resolve
    })
    const order: string[] = []
    const reads = answer(
      'tasks/get',
      async () => {
        order.push('first started')
        await firstRead
        order.push('first done')
        return task
      },
      () => {
        order.push('second started')
        return { ...task, status: 'running' }
      },
    )
    watch()
    await waitFor(() => expect(joins).toHaveLength(1))

    joins[0]!.message({ taskId: task.id })
    await waitFor(() => expect(reads).toHaveLength(1))
    joins[0]!.message({ taskId: task.id })
    joins[0]!.message({ taskId: task.id })
    await settle()
    expect(reads).toHaveLength(1)

    release()
    await waitFor(() => expect(reads).toHaveLength(2))
    await settle()
    expect(reads).toHaveLength(2)
    expect(order).toEqual(['first started', 'first done', 'second started'])
  })

  it('joins again when the channel goes down, and reads the lists on a timer after failing several times in a row, until a join works', async () => {
    const { queryClient } = watch()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    for (let failure = 1; failure <= FALLBACK_AFTER_FAILURES; failure += 1) {
      await waitFor(() => expect(joins).toHaveLength(failure))
      expect(joins[failure - 1]!.closed).toBe(false)
      joins[failure - 1]!.down()
    }
    expect(invalidate).not.toHaveBeenCalled()
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: orpc.tasks.key() }))

    await waitFor(() => expect(joins).toHaveLength(FALLBACK_AFTER_FAILURES + 1))
    joins.at(-1)!.subscribed()
    await settle()
    invalidate.mockClear()
    await new Promise((resolve) => setTimeout(resolve, FAST.fallbackRefreshMs * 3))
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('joins nothing without an organization, and joins once one is given', async () => {
    const { rerender } = watch({ organizationId: null })
    await settle()
    expect(joins).toHaveLength(0)

    rerender({ organizationId: ORGANIZATION })
    await waitFor(() => expect(joins).toHaveLength(1))
  })

  it('leaves the channel while the page is hidden and joins again when it shows', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    watch()
    await settle()
    expect(joins).toHaveLength(0)

    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(joins).toHaveLength(1))

    visibility.mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(joins[0]!.closed).toBe(true))

    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(joins).toHaveLength(2))
  })

  it('leaves the channel and joins again when the organization changes', async () => {
    const { rerender } = watch()
    await waitFor(() => expect(joins).toHaveLength(1))

    rerender({ organizationId: OTHER_ORGANIZATION })
    await waitFor(() => expect(joins).toHaveLength(2))
    expect(joins[0]!.closed).toBe(true)
    expect(joins[1]!.closed).toBe(false)
  })
})
