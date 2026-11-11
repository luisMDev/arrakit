import type { PGlite } from '@electric-sql/pglite'
import pg from 'pg'

import type { DataLog } from '../context'

/** The Postgres channel task changes are notified on, once their transaction commits. */
export const TASK_CHANNEL = 'task_changes'

export interface TaskNotice {
  organizationId: string
  taskId: string
}

export interface TaskFeedListener {
  /** A task of the organization changed: read it to see how it is now. */
  notice(notice: TaskNotice): void
  /** Notices may have been missed (the feed lost its connection and is back): read again. */
  resync(): void
}

/**
 * Task changes as they commit, for the organizations someone watches. Notices are not stored: one
 * sent while the feed is down is lost, and `resync` says so once it is back.
 */
export interface TaskFeed {
  /** Resolves once listening; the function it resolves to stops the listener. */
  subscribe(organizationId: string, listener: TaskFeedListener): Promise<() => void>
  close(): Promise<void>
}

const MAX_RETRY_MS = 30_000

function listeners(log: DataLog) {
  const byOrganization = new Map<string, Set<TaskFeedListener>>()
  const each = (run: (listener: TaskFeedListener) => void, all: Iterable<TaskFeedListener>) => {
    for (const listener of all) {
      try {
        run(listener)
      } catch (err) {
        log.error({ err }, 'task feed listener failed')
      }
    }
  }
  return {
    add(organizationId: string, listener: TaskFeedListener) {
      const set = byOrganization.get(organizationId) ?? new Set()
      byOrganization.set(organizationId, set.add(listener))
      return () => {
        set.delete(listener)
        if (set.size === 0) byOrganization.delete(organizationId)
      }
    },
    deliver(payload: string | undefined) {
      let notice: TaskNotice
      try {
        notice = JSON.parse(payload ?? '') as TaskNotice
      } catch (err) {
        log.error({ err }, 'task notice unreadable')
        return
      }
      each(
        (listener) => listener.notice(notice),
        [...(byOrganization.get(notice.organizationId) ?? [])],
      )
    },
    resyncAll() {
      each(
        (listener) => listener.resync(),
        [...byOrganization.values()].flatMap((set) => [...set]),
      )
    },
  }
}

/** Listens on the PGlite instance Drizzle uses (dev, tests and e2e). */
export function pgliteTaskFeed(db: PGlite, log: DataLog): TaskFeed {
  const fanOut = listeners(log)
  let listening: Promise<() => Promise<void>> | undefined
  return {
    async subscribe(organizationId, listener) {
      const remove = fanOut.add(organizationId, listener)
      listening ??= db.listen(TASK_CHANNEL, (payload) => fanOut.deliver(payload))
      await listening
      return remove
    },
    async close() {
      const unlisten = await listening
      if (unlisten && !db.closed) await unlisten()
    },
  }
}

/**
 * Listens on one connection of its own, opened on the first subscription. LISTEN needs a session,
 * so `url` must not go through a pooler in transaction mode. A lost connection is opened again,
 * waiting longer each time it fails, and every listener is then told to resync.
 */
export function postgresTaskFeed(
  url: string,
  log: DataLog,
  { retryMs = 1000 }: { retryMs?: number } = {},
): TaskFeed {
  const fanOut = listeners(log)
  let client: pg.Client | undefined
  let listening: Promise<void> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let closed = false

  function lost(err?: unknown) {
    if (closed || !client) return
    if (err) log.error({ err }, 'task feed connection lost')
    client.removeAllListeners()
    void client.end().catch(() => {})
    client = undefined
    listening = undefined
    reconnect()
  }

  function reconnect() {
    const wait = Math.min(MAX_RETRY_MS, retryMs * 2 ** failures)
    retry = setTimeout(() => {
      retry = undefined
      listen().then(
        () => fanOut.resyncAll(),
        (err: unknown) => {
          failures += 1
          log.error({ err }, 'task feed not listening; retrying')
          if (!closed) reconnect()
        },
      )
    }, wait)
  }

  function listen(): Promise<void> {
    listening ??= (async () => {
      const next = new pg.Client({ connectionString: url })
      next.on('notification', (message) => fanOut.deliver(message.payload))
      next.on('error', (err) => lost(err))
      next.on('end', () => lost())
      try {
        await next.connect()
        await next.query(`LISTEN ${TASK_CHANNEL}`)
      } catch (err) {
        next.removeAllListeners()
        await next.end().catch(() => {})
        listening = undefined
        throw err
      }
      if (closed) {
        await next.end()
        return
      }
      client = next
      failures = 0
    })()
    return listening
  }

  return {
    async subscribe(organizationId, listener) {
      const remove = fanOut.add(organizationId, listener)
      try {
        await listen()
      } catch (err) {
        remove()
        throw err
      }
      return remove
    },
    async close() {
      closed = true
      if (retry) clearTimeout(retry)
      await listening?.catch(() => {})
      const current = client
      client = undefined
      if (current) {
        current.removeAllListeners()
        await current.end()
      }
    },
  }
}
