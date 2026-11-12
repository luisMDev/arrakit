import {
  TASK_PAGE_MAX,
  TASK_SIGNAL_EVENT,
  type TaskPage,
  type TaskView,
  taskSignalSchema,
} from '@arrakit/contract'
import { type QueryClient, type QueryKey, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import { client, orpc } from '#/lib/orpc'
import { joinChannel } from '#/lib/realtime'

import { isActive } from './task-copy'

const FINISHED_PAGE = 50

/**
 * The queued or running tasks the person may see, of one workspace or of the whole organization:
 * the organization's is shared by Settings > Tasks and the shell's indicator.
 */
export const activeTasksQuery = (workspaceId?: string) =>
  orpc.tasks.list.queryOptions({
    input: { status: 'active', limit: TASK_PAGE_MAX, ...(workspaceId ? { workspaceId } : {}) },
  })

export const finishedTasksQuery = (workspaceId?: string) =>
  orpc.tasks.list.infiniteOptions({
    input: (after: string | undefined) => ({
      status: 'finished',
      after,
      limit: FINISHED_PAGE,
      ...(workspaceId ? { workspaceId } : {}),
    }),
    initialPageParam: undefined,
    getNextPageParam: (page: TaskPage) => page.next ?? undefined,
  })

/** Reads every task list again: after starting a task, or when changes may have been missed. */
export const refreshTasks = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: orpc.tasks.key() })

const inputOf = (key: QueryKey) =>
  (key[1] as { input?: { status?: string; workspaceId?: string } } | undefined)?.input

/**
 * Puts a task as it is now into the cached lists: an active one at the top of the active lists of
 * its scope, a finished one out of them, for the finished lists to read again. True when the task
 * was in an active list and has just finished.
 */
export function applyTaskChange(queryClient: QueryClient, task: TaskView): boolean {
  const active = isActive(task)
  let wasListed = false
  const lists = queryClient.getQueriesData<TaskPage>({
    queryKey: orpc.tasks.list.key({ type: 'query' }),
  })
  for (const [key, page] of lists) {
    const input = inputOf(key)
    if (!page || input?.status !== 'active') continue
    const listed = page.tasks.some((each) => each.id === task.id)
    wasListed ||= listed
    const inScope = !input.workspaceId || input.workspaceId === task.workspaceId
    let tasks = page.tasks.filter((each) => each.id !== task.id)
    if (active && inScope) {
      tasks = listed
        ? page.tasks.map((each) => (each.id === task.id ? task : each))
        : [task, ...tasks]
    }
    queryClient.setQueryData<TaskPage>(key, { ...page, tasks })
  }
  queryClient.setQueryData(orpc.tasks.get.queryKey({ input: { id: task.id } }), task)
  if (!active) {
    void queryClient.invalidateQueries({ queryKey: orpc.tasks.list.key({ type: 'infinite' }) })
  }
  return wasListed && !active
}

/** Waits before joining the task channel again, after each failure in a row. */
export const RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
/** Failed joins in a row after which the lists are also read on a timer, until one works. */
export const FALLBACK_AFTER_FAILURES = 3
export const FALLBACK_REFRESH_MS = 20_000

const jittered = (ms: number) => ms / 2 + Math.random() * (ms / 2)

function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

const usePageVisible = () =>
  useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== 'hidden',
    () => true,
  )

/**
 * Keeps the cached task lists of `organizationId` current while it is given and the page is
 * visible, from the task signals on its private Realtime channel: the lists are read again once
 * the channel is joined, and each signalled task is read through the API, one at a time in the
 * order the signals came. A dropped channel is joined again, waiting longer each time it fails;
 * after FALLBACK_AFTER_FAILURES failures in a row the lists are also read every
 * FALLBACK_REFRESH_MS. `onFinished` hears of each listed task that finishes.
 */
export function useTaskWatch(
  organizationId: string | null,
  onFinished?: (task: TaskView) => void,
  { retryMs = RETRY_MS, fallbackRefreshMs = FALLBACK_REFRESH_MS } = {},
) {
  const queryClient = useQueryClient()
  const visible = usePageVisible()
  const finished = useRef(onFinished)
  useEffect(() => {
    finished.current = onFinished
  }, [onFinished])

  useEffect(() => {
    if (!organizationId || !visible) return
    let stopped = false
    let failures = 0
    let channel: { close(): void } | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let fallback: ReturnType<typeof setInterval> | undefined
    const stopFallback = () => {
      clearInterval(fallback)
      fallback = undefined
    }

    const waiting: string[] = []
    let reading = false
    async function readWaiting() {
      if (reading) return
      reading = true
      while (!stopped && waiting.length > 0) {
        const id = waiting.shift()!
        const task = await client.tasks.get({ id }).catch(() => undefined)
        if (!stopped && task && applyTaskChange(queryClient, task)) finished.current?.(task)
      }
      reading = false
    }

    function join() {
      channel = joinChannel((topics) => topics.tasks, TASK_SIGNAL_EVENT, {
        subscribed() {
          failures = 0
          stopFallback()
          void refreshTasks(queryClient)
        },
        message(payload) {
          const signal = taskSignalSchema.safeParse(payload)
          if (!signal.success || waiting.includes(signal.data.taskId)) return
          waiting.push(signal.data.taskId)
          void readWaiting()
        },
        down() {
          failures += 1
          if (failures >= FALLBACK_AFTER_FAILURES && !fallback) {
            fallback = setInterval(() => void refreshTasks(queryClient), fallbackRefreshMs)
          }
          const wait = retryMs[Math.min(failures, retryMs.length) - 1]!
          retry = setTimeout(join, jittered(wait))
        },
      })
    }
    join()
    return () => {
      stopped = true
      channel?.close()
      clearTimeout(retry)
      stopFallback()
    }
  }, [organizationId, visible, queryClient, retryMs, fallbackRefreshMs])
}
