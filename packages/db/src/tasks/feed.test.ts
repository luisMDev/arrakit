import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { transaction } from '../connection'
import { consoleLog } from '../context'
import { type TestData, insertOrganization, insertUser, openTestData } from '../testing'
import {
  FEED_NOT_RECEIVING,
  TASK_CHANNEL,
  type TaskFeedListener,
  type TaskNotice,
  pgliteTaskFeed,
  postgresTaskFeed,
} from './feed'

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

function recorder() {
  const notices: TaskNotice[] = []
  let resyncs = 0
  const listener: TaskFeedListener = {
    notice: (notice) => notices.push(notice),
    resync: () => {
      resyncs += 1
    },
  }
  return { listener, notices, resyncs: () => resyncs }
}

describe('task feed on PGlite', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  const organization = async (tag: string) => {
    const owner = await insertUser(data, `owner@${tag}.vc`)
    const { id } = await insertOrganization(data, { slug: tag })
    const tasks = data.asSystem(id).tasks
    const start = () =>
      tasks.start({
        queue: 'export',
        kind: 'workspace.export',
        workspaceId: null,
        requestedBy: owner,
        maxAttempts: 1,
        input: {},
      })
    return { organizationId: id, tasks, start }
  }

  it('tells the organization about every change to its tasks, and no one else', async () => {
    const f = await organization('alder')
    const other = await organization('birch')
    const mine = recorder()
    const theirs = recorder()
    await data.taskFeed.subscribe(f.organizationId, mine.listener)
    await data.taskFeed.subscribe(other.organizationId, theirs.listener)

    const task = await f.start()
    await f.tasks.begin(task.id, 0)
    await f.tasks.progress(task.id, 1, 2)
    await f.tasks.succeed(task.id)
    await f.tasks.fail(task.id, 'unexpected')
    await settle()

    const notice = { organizationId: f.organizationId, taskId: task.id }
    expect(mine.notices).toEqual([notice, notice, notice, notice])
    expect(theirs.notices).toEqual([])
  })

  it('sends nothing for a change that rolls back', async () => {
    const f = await organization('cedar')
    const watcher = recorder()
    await data.taskFeed.subscribe(f.organizationId, watcher.listener)

    await expect(
      transaction(data.db, async (tx) => {
        await tx.execute(
          `select pg_notify('${TASK_CHANNEL}', '${JSON.stringify({ organizationId: f.organizationId, taskId: 'x' })}')`,
        )
        throw new Error('abort')
      }),
    ).rejects.toThrow('abort')
    await settle()
    expect(watcher.notices).toEqual([])
  })

  it('stops telling a listener once it unsubscribes', async () => {
    const f = await organization('dogwood')
    const watcher = recorder()
    const stop = await data.taskFeed.subscribe(f.organizationId, watcher.listener)
    await f.start()
    await settle()
    stop()
    await f.start()
    await settle()
    expect(watcher.notices).toHaveLength(1)
  })

  it('passes its probe when a notice sent through the database reaches it, and fails when none does', async () => {
    await expect(data.taskFeed.probe()).resolves.toBeUndefined()
    const feed = pgliteTaskFeed((data.db as unknown as { $client: PGlite }).$client, consoleLog)
    await expect(feed.probe(async () => {}, 50)).rejects.toThrow(FEED_NOT_RECEIVING)
    await feed.close()
  })

  it('keeps telling the others when a listener throws', async () => {
    const f = await organization('elm')
    const watcher = recorder()
    await data.taskFeed.subscribe(f.organizationId, {
      notice: () => {
        throw new Error('listener broke')
      },
      resync: () => {},
    })
    await data.taskFeed.subscribe(f.organizationId, watcher.listener)
    await f.start()
    await settle()
    expect(watcher.notices).toHaveLength(1)
  })
})

const url = process.env.DATABASE_URL

describe.runIf(url)('task feed on Postgres (DATABASE_URL)', () => {
  it('listens on its own connection, comes back after losing it and asks to resync', async () => {
    const { default: pg } = await import('pg')
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    const feed = postgresTaskFeed(url!, consoleLog, { retryMs: 50 })
    const watcher = recorder()
    try {
      await feed.subscribe('org-1', watcher.listener)
      const notify = () =>
        admin.query('select pg_notify($1, $2)', [
          TASK_CHANNEL,
          JSON.stringify({ organizationId: 'org-1', taskId: 't' }),
        ])
      await notify()
      await settle()
      expect(watcher.notices).toHaveLength(1)

      await admin.query(
        `select pg_terminate_backend(pid) from pg_stat_activity
         where pid <> pg_backend_pid() and query = $1`,
        [`LISTEN ${TASK_CHANNEL}`],
      )
      const deadline = Date.now() + 10_000
      while (watcher.resyncs() === 0 && Date.now() < deadline) await settle()
      expect(watcher.resyncs()).toBe(1)

      await notify()
      await settle()
      expect(watcher.notices).toHaveLength(2)

      await expect(
        feed.probe((payload) => admin.query('select pg_notify($1, $2)', [TASK_CHANNEL, payload])),
      ).resolves.toBeUndefined()
    } finally {
      await feed.close()
      await admin.end()
    }
  }, 30_000)
})
