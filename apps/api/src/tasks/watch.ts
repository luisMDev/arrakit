import type { ListedTask, ScopedData } from '@arrakit/db'

import type { Logger } from '../observability/logger'

export interface TaskWatcher {
  /** A task of the organization as it is now, read once for every watcher. */
  task(row: ListedTask): void
  resync(): void
  /** The server is stopping: finish the stream. */
  end(): void
}

interface Watched {
  watchers: Set<TaskWatcher>
  subscribed: Promise<() => void>
}

/**
 * One task feed subscription per organization someone watches, shared by everyone watching it in
 * this process: each notice reads the task once, then every watcher gets the row.
 */
export function taskWatchHub(data: ScopedData, log: Logger) {
  const organizations = new Map<string, Watched>()

  function each(watchers: Iterable<TaskWatcher>, run: (watcher: TaskWatcher) => void) {
    for (const watcher of [...watchers]) {
      try {
        run(watcher)
      } catch (err) {
        log.error({ err }, 'task watcher failed')
      }
    }
  }

  function watchedOf(organizationId: string): Watched {
    const existing = organizations.get(organizationId)
    if (existing) return existing
    const watchers = new Set<TaskWatcher>()
    const tasks = data.asSystem(organizationId).tasks
    // One read at a time, in the order the notices came: a slow read must not hand watchers a
    // task older than the one they already have.
    let reads = Promise.resolve()
    const subscribed = data.taskFeed.subscribe(organizationId, {
      notice: ({ taskId }) => {
        reads = reads.then(async () => {
          try {
            const row = await tasks.get(taskId)
            if (row) each(watchers, (watcher) => watcher.task(row))
          } catch (err) {
            log.error({ err, organizationId, taskId }, 'changed task not read')
          }
        })
      },
      resync: () => each(watchers, (watcher) => watcher.resync()),
    })
    const watched = { watchers, subscribed }
    organizations.set(organizationId, watched)
    subscribed.catch(() => organizations.delete(organizationId))
    return watched
  }

  return {
    /** Resolves once the organization is listened to; the function it resolves to stops watching. */
    async watch(organizationId: string, watcher: TaskWatcher): Promise<() => void> {
      const watched = watchedOf(organizationId)
      watched.watchers.add(watcher)
      try {
        await watched.subscribed
      } catch (err) {
        watched.watchers.delete(watcher)
        throw err
      }
      return () => {
        watched.watchers.delete(watcher)
        if (watched.watchers.size > 0 || organizations.get(organizationId) !== watched) return
        organizations.delete(organizationId)
        void watched.subscribed.then((stop) => stop())
      }
    },
    /** Ends every stream, so the server can stop. */
    close() {
      for (const { watchers } of organizations.values()) each(watchers, (watcher) => watcher.end())
    },
  }
}

export type TaskWatchHub = ReturnType<typeof taskWatchHub>
