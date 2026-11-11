import { TASK_PAGE_MAX, type TaskPage, type TaskView } from '@arrakit/contract'
import { type QueryClient, type QueryKey, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import { client, orpc } from '#/lib/orpc'

import { isActive } from './task-copy'

const FINISHED_PAGE = 50

/** Every queued or running task the person may see: one query shared by the page and the shell. */
export const activeTasksQuery = () =>
  orpc.tasks.list.queryOptions({ input: { status: 'active', limit: TASK_PAGE_MAX } })

export const finishedTasksQuery = () =>
  orpc.tasks.list.infiniteOptions({
    input: (after: string | undefined) => ({ status: 'finished', after, limit: FINISHED_PAGE }),
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

/** Waits before opening the stream again, after each failure in a row. */
export const RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
/** Failed streams in a row after which the lists are also read on a timer, until one works. */
export const FALLBACK_AFTER_FAILURES = 3
export const FALLBACK_REFRESH_MS = 20_000

const jittered = (ms: number) => ms / 2 + Math.random() * (ms / 2)

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })

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
 * Keeps the cached task lists current from the API's task stream while `enabled` and the page is
 * visible. A dropped stream is opened again, waiting longer each time it fails; after
 * FALLBACK_AFTER_FAILURES failures in a row the lists are also read every FALLBACK_REFRESH_MS.
 * `onFinished` hears of each listed task that finishes.
 */
export function useTaskWatch(
  enabled: boolean,
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
    if (!enabled || !visible) return
    const controller = new AbortController()
    const { signal } = controller
    let failures = 0
    let fallback: ReturnType<typeof setInterval> | undefined
    const stopFallback = () => {
      clearInterval(fallback)
      fallback = undefined
    }

    async function watch() {
      while (!signal.aborted) {
        try {
          const stream = await client.tasks.watch({}, { signal })
          for await (const change of stream) {
            if (change.type === 'resync') {
              failures = 0
              stopFallback()
              void refreshTasks(queryClient)
            } else if (applyTaskChange(queryClient, change.task)) {
              finished.current?.(change.task)
            }
          }
          await sleep(jittered(retryMs[0]!), signal)
        } catch {
          if (signal.aborted) return
          failures += 1
          if (failures >= FALLBACK_AFTER_FAILURES && !fallback) {
            fallback = setInterval(() => void refreshTasks(queryClient), fallbackRefreshMs)
          }
          const wait = retryMs[Math.min(failures, retryMs.length) - 1]!
          await sleep(jittered(wait), signal)
        }
      }
    }
    void watch()
    return () => {
      controller.abort()
      stopFallback()
    }
  }, [enabled, visible, queryClient, retryMs, fallbackRefreshMs])
}
