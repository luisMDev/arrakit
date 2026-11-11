import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { TASK_EVENTS } from '../tasks/events'
import {
  type QueuedTestData,
  type TestData,
  insertOrganization,
  insertUser,
  openTestData,
  openTestDataWithQueue,
  rawSql,
} from '../testing'
import type { NewTask } from './tasks'

const START = new Date('2026-03-02T09:00:00.000Z')
const minutes = (n: number) => n * 60_000

describe('organization tasks', () => {
  let data: TestData
  let clock = START
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms)
  }

  beforeAll(async () => {
    data = await openTestData({ now: () => clock })
  })
  afterAll(() => data.close())

  const organizationOf = async (tag: string) => {
    const owner = await insertUser(data, `owner@${tag}.vc`, `Owner ${tag}`)
    const organization = await insertOrganization(data, { slug: tag })
    const scope = data.forOrganization(organization.id)
    const workspace = await scope.workspaces.create({
      name: 'Deals',
      description: '',
      createdBy: owner,
    })
    const task = (overrides: Partial<NewTask> = {}): NewTask => ({
      queue: 'export',
      kind: 'workspace.export',
      workspaceId: null,
      requestedBy: owner,
      maxAttempts: 3,
      input: { format: 'zip' },
      ...overrides,
    })
    return { owner, organizationId: organization.id, scope, tasks: scope.tasks, workspace, task }
  }

  const publishedSince = (start: number) => data.jobs.published.slice(start)

  it('starts a queued task and queues its job with the task id', async () => {
    const f = await organizationOf('alder')
    const row = await f.tasks.start(
      f.task({
        workspaceId: f.workspace.id,
        subject: { type: 'workspace', id: f.workspace.id },
        label: 'Deals',
      }),
    )

    expect(row).toMatchObject({
      organizationId: f.organizationId,
      workspaceId: f.workspace.id,
      kind: 'workspace.export',
      subjectType: 'workspace',
      subjectId: f.workspace.id,
      label: 'Deals',
      requestedBy: f.owner,
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      progressDone: 0,
      progressTotal: null,
      createdAt: clock,
    })
    expect(data.jobs.sent.at(-1)).toMatchObject({
      name: 'export',
      data: { taskId: row.id, organizationId: f.organizationId, input: { format: 'zip' } },
    })
    expect(await f.tasks.get(row.id)).toMatchObject({ id: row.id, requesterName: 'Owner alder' })
  })

  it('keeps no task when its job cannot be queued', async () => {
    const f = await organizationOf('birch')
    const send = vi.spyOn(data.jobs, 'send').mockRejectedValueOnce(new Error('queue down'))
    await expect(f.tasks.start(f.task())).rejects.toThrow('queue down')
    send.mockRestore()

    expect((await f.tasks.list({ status: 'active', limit: 10 })).tasks).toEqual([])
  })

  it('refuses a workspace of another organization and keeps organizations apart', async () => {
    const f = await organizationOf('cedar')
    const other = await organizationOf('dogwood')
    await expect(f.tasks.start(f.task({ workspaceId: other.workspace.id }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })

    const row = await f.tasks.start(f.task())
    expect(await other.tasks.get(row.id)).toBeUndefined()
    expect(await other.tasks.begin(row.id, 0)).toBeUndefined()
    expect(await other.tasks.fail(row.id, 'unexpected')).toBeUndefined()
    expect((await other.tasks.list({ status: 'active', limit: 10 })).tasks).toEqual([])
    expect((await f.tasks.get(row.id))!.status).toBe('queued')
  })

  it('runs a task to success, with all its work done, and publishes task.succeeded', async () => {
    const f = await organizationOf('elm')
    const row = await f.tasks.start(f.task({ subject: { type: 'workspace', id: f.workspace.id } }))
    advance(minutes(1))
    const running = await f.tasks.begin(row.id, 0)
    expect(running).toMatchObject({ status: 'running', attempts: 1, startedAt: clock })

    expect(await f.tasks.progress(row.id, 3, 10)).toMatchObject({
      progressDone: 3,
      progressTotal: 10,
    })
    const start = data.jobs.published.length
    advance(minutes(1))
    const done = await f.tasks.succeed(row.id, { url: 'exports/1.zip' })

    expect(done).toMatchObject({
      status: 'succeeded',
      progressDone: 10,
      progressTotal: 10,
      result: { url: 'exports/1.zip' },
      finishedAt: clock,
    })
    expect(publishedSince(start)).toEqual([
      expect.objectContaining({
        event: TASK_EVENTS.succeeded,
        data: {
          organizationId: f.organizationId,
          workspaceId: null,
          taskId: row.id,
          kind: 'workspace.export',
          subjectType: 'workspace',
          subjectId: f.workspace.id,
          requestedBy: f.owner,
          occurredAt: clock.toISOString(),
        },
      }),
    ])
  })

  it('keeps progress within its total, and within the known total when none is given', async () => {
    const f = await organizationOf('fir')
    const row = await f.tasks.start(f.task())
    expect(await f.tasks.progress(row.id, 1, 5)).toBeUndefined()
    await f.tasks.begin(row.id, 0)

    expect(await f.tasks.progress(row.id, 4)).toMatchObject({
      progressDone: 4,
      progressTotal: null,
    })
    expect(await f.tasks.progress(row.id, 12, 8)).toMatchObject({
      progressDone: 8,
      progressTotal: 8,
    })
    expect(await f.tasks.progress(row.id, 20)).toMatchObject({ progressDone: 8 })
    expect(await f.tasks.progress(row.id, -3)).toMatchObject({ progressDone: 0 })
    expect(await f.tasks.progress(row.id, 2.7, 4)).toMatchObject({ progressDone: 2 })
  })

  it('keeps a running task alive with a heartbeat, and only a running one', async () => {
    const f = await organizationOf('hornbeam')
    const row = await f.tasks.start(f.task())
    expect(await f.tasks.heartbeat(row.id)).toBe(false)
    await f.tasks.begin(row.id, 0)
    advance(minutes(5))
    expect(await f.tasks.heartbeat(row.id)).toBe(true)
    expect((await f.tasks.get(row.id))!.updatedAt).toEqual(clock)
  })

  it('lets an attempt move the task only while it is the latest one', async () => {
    const f = await organizationOf('holly')
    const row = await f.tasks.start(f.task())
    const first = (await f.tasks.begin(row.id, 0))!.attempts
    const second = (await f.tasks.begin(row.id, 1))!.attempts
    const stale = f.tasks.attempt(row.id, first)
    const start = data.jobs.published.length

    expect(await stale.progress(1, 2)).toBeUndefined()
    expect(await stale.heartbeat()).toBe(false)
    expect(await stale.retrying('unexpected')).toBeUndefined()
    expect(await stale.succeed()).toBeUndefined()
    expect(await stale.fail('unexpected')).toBeUndefined()
    expect(await f.tasks.get(row.id)).toMatchObject({ status: 'running', attempts: second })
    expect(publishedSince(start)).toEqual([])

    const latest = f.tasks.attempt(row.id, second)
    expect(await latest.progress(1, 2)).toMatchObject({ progressDone: 1 })
    expect(await latest.heartbeat()).toBe(true)
    expect(await latest.succeed()).toMatchObject({ status: 'succeeded' })
    expect(publishedSince(start).map((e) => e.event)).toEqual([TASK_EVENTS.succeeded])
  })

  it('goes back to queued between attempts and keeps its first start', async () => {
    const f = await organizationOf('ginkgo')
    const row = await f.tasks.start(f.task())
    await f.tasks.begin(row.id, 0)
    const startedAt = clock
    const start = data.jobs.published.length

    advance(minutes(1))
    expect(await f.tasks.retrying(row.id, 'unexpected')).toMatchObject({
      status: 'queued',
      errorCode: 'unexpected',
      attempts: 1,
    })
    advance(minutes(1))
    expect(await f.tasks.begin(row.id, 1)).toMatchObject({
      status: 'running',
      attempts: 2,
      errorCode: null,
      startedAt,
    })
    expect(publishedSince(start)).toEqual([])
  })

  it('fails a queued or running task once, and publishes task.failed with the code', async () => {
    const f = await organizationOf('hazel')
    const queued = await f.tasks.start(f.task())
    const running = await f.tasks.start(f.task())
    await f.tasks.begin(running.id, 0)
    const start = data.jobs.published.length

    expect(await f.tasks.fail(queued.id, 'stalled')).toMatchObject({
      status: 'failed',
      errorCode: 'stalled',
      finishedAt: clock,
    })
    expect(await f.tasks.fail(running.id, 'unexpected')).toMatchObject({ status: 'failed' })
    expect(await f.tasks.fail(running.id, 'unexpected')).toBeUndefined()

    expect(publishedSince(start).map(({ event, data: payload }) => [event, payload])).toEqual([
      [TASK_EVENTS.failed, expect.objectContaining({ taskId: queued.id, errorCode: 'stalled' })],
      [
        TASK_EVENTS.failed,
        expect.objectContaining({ taskId: running.id, errorCode: 'unexpected' }),
      ],
    ])
  })

  it('never moves a finished task, and publishes nothing when a move does not apply', async () => {
    const f = await organizationOf('ivy')
    const row = await f.tasks.start(f.task())
    expect(await f.tasks.succeed(row.id)).toBeUndefined()
    expect(await f.tasks.retrying(row.id, 'unexpected')).toBeUndefined()
    await f.tasks.begin(row.id, 0)
    await f.tasks.succeed(row.id)
    const start = data.jobs.published.length

    expect(await f.tasks.begin(row.id, 1)).toBeUndefined()
    expect(await f.tasks.progress(row.id, 1)).toBeUndefined()
    expect(await f.tasks.succeed(row.id)).toBeUndefined()
    expect(await f.tasks.fail(row.id, 'unexpected')).toBeUndefined()
    expect((await f.tasks.get(row.id))!.status).toBe('succeeded')
    expect(publishedSince(start)).toEqual([])
  })

  it('lists active or finished tasks newest first, a page at a time', async () => {
    const f = await organizationOf('juniper')
    const ids: string[] = []
    for (let i = 0; i < 5; i += 1) {
      advance(1000)
      ids.push((await f.tasks.start(f.task())).id)
    }
    await f.tasks.begin(ids[0]!, 0)
    await f.tasks.succeed(ids[0]!)

    const first = await f.tasks.list({ status: 'active', limit: 2 })
    expect(first.tasks.map((task) => task.id)).toEqual([ids[4], ids[3]])
    const second = await f.tasks.list({ status: 'active', limit: 2, after: first.next! })
    expect(second.tasks.map((task) => task.id)).toEqual([ids[2], ids[1]])
    expect(second.next).toBeNull()
    expect((await f.tasks.list({ status: 'finished', limit: 2 })).tasks.map((t) => t.id)).toEqual([
      ids[0],
    ])
  })

  it('pages tasks created at the same moment by id', async () => {
    const f = await organizationOf('kapok')
    const ids = [
      (await f.tasks.start(f.task())).id,
      (await f.tasks.start(f.task())).id,
      (await f.tasks.start(f.task())).id,
    ].sort()

    const seen: string[] = []
    let after = undefined as Parameters<typeof f.tasks.list>[0]['after']
    do {
      const page = await f.tasks.list({ status: 'active', limit: 1, after })
      seen.push(...page.tasks.map((task) => task.id))
      after = page.next ?? undefined
    } while (after)
    expect(seen).toEqual([...ids].reverse())
  })

  it('filters by workspace, organization-wide work and requester', async () => {
    const f = await organizationOf('larch')
    const colleague = await insertUser(data, 'colleague@larch.vc')
    const own = await f.tasks.start(f.task())
    const inWorkspace = await f.tasks.start(f.task({ workspaceId: f.workspace.id }))
    const theirs = await f.tasks.start(f.task({ requestedBy: colleague }))
    const idsOf = async (options: Partial<Parameters<typeof f.tasks.list>[0]>) =>
      (await f.tasks.list({ status: 'active', limit: 10, ...options })).tasks
        .map((task) => task.id)
        .sort()

    expect(await idsOf({})).toEqual([own.id, inWorkspace.id, theirs.id].sort())
    expect(await idsOf({ workspaceId: f.workspace.id })).toEqual([inWorkspace.id])
    expect(await idsOf({ workspaceId: null })).toEqual([own.id, theirs.id].sort())
    expect(await idsOf({ requestedBy: colleague })).toEqual([theirs.id])
  })

  it('finds stalled tasks across organizations and removes old finished ones', async () => {
    const f = await organizationOf('maple')
    const other = await organizationOf('oak')
    const silent = await f.tasks.start(f.task())
    await f.tasks.begin(silent.id, 0)
    const waiting = await other.tasks.start(other.task())
    const finished = await f.tasks.start(f.task())
    await f.tasks.begin(finished.id, 0)
    await f.tasks.succeed(finished.id)

    advance(minutes(40))
    const lively = await f.tasks.start(f.task())
    await f.tasks.begin(lively.id, 0)
    const stalled = await data.stalledTasks({
      runningBefore: new Date(clock.getTime() - minutes(30)),
      queuedBefore: new Date(clock.getTime() - minutes(30)),
    })
    expect(stalled).toEqual(
      expect.arrayContaining([
        { organizationId: f.organizationId, id: silent.id },
        { organizationId: other.organizationId, id: waiting.id },
      ]),
    )
    expect(stalled.map((task) => task.id)).not.toContain(lively.id)
    expect(stalled.map((task) => task.id)).not.toContain(finished.id)

    expect(await data.removeFinishedTasks(new Date(clock.getTime() - minutes(30)))).toBeGreaterThan(
      0,
    )
    expect(await f.tasks.get(finished.id)).toBeUndefined()
    expect(await f.tasks.get(silent.id)).toBeDefined()
  })

  it('goes with its organization, and keeps tasks whose requester is gone', async () => {
    const f = await organizationOf('pine')
    const row = await f.tasks.start(f.task())
    await rawSql(data)('DELETE FROM users WHERE id = $1', [f.owner])
    expect(await f.tasks.get(row.id)).toMatchObject({ requestedBy: null, requesterName: null })

    await rawSql(data)('DELETE FROM organizations WHERE id = $1', [f.organizationId])
    const { rows } = await rawSql(data)('SELECT id FROM tasks WHERE id = $1', [row.id])
    expect(rows).toEqual([])
  })
})

describe('organization tasks on pg-boss', () => {
  let data: QueuedTestData

  beforeAll(async () => {
    data = await openTestDataWithQueue()
  }, 60_000)
  afterAll(() => data.close())

  it('queues the job in the same transaction as the task, or neither', async () => {
    const owner = await insertUser(data, 'owner@quince.vc')
    const { id: organizationId } = await insertOrganization(data, { slug: 'quince' })
    const tasks = data.forOrganization(organizationId).tasks
    await data.jobs.defineQueue('export', { retryLimit: 1, retryDelay: 1, retryBackoff: false })
    const task = {
      kind: 'workspace.export',
      workspaceId: null,
      requestedBy: owner,
      maxAttempts: 2,
      input: { n: 1 },
    }

    const row = await tasks.start({ ...task, queue: 'export' })
    const { rows } = await rawSql(data)('SELECT data FROM pgboss.job WHERE name = $1', ['export'])
    expect(rows).toEqual([{ data: { taskId: row.id, organizationId, input: { n: 1 } } }])

    const send = data.jobs.send.bind(data.jobs)
    const failing = vi.spyOn(data.jobs, 'send').mockImplementationOnce(async (...args) => {
      await send(...args)
      throw new Error('after the job was written')
    })
    await expect(tasks.start({ ...task, queue: 'export' })).rejects.toThrow('after the job')
    failing.mockRestore()

    const after = await rawSql(data)('SELECT data FROM pgboss.job WHERE name = $1', ['export'])
    expect(after.rows).toHaveLength(1)
    expect((await tasks.list({ status: 'active', limit: 10 })).tasks.map((t) => t.id)).toEqual([
      row.id,
    ])
  }, 60_000)
})
