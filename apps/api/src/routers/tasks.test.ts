import { TASK_SIGNAL_EVENT, taskSignalSchema } from '@arrakit/contract'
import type { NewTask } from '@arrakit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { BAD_CURSOR, NO_SUCH_TASK } from '../tasks/tasks'
import { type TestApp, createTestApp } from '../testing/app'
import { joinAs, ownerOf, sqlOf } from '../testing/people'

describe('tasks', () => {
  let t: TestApp
  let counter = 0

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  const organization = async () => {
    counter += 1
    const owner = await ownerOf(t, `owner${counter}@tasks.com`, 'free', 'Olga')
    const member = await joinAs(t, owner.organizationId, `member${counter}@tasks.com`, 'member')
    const guest = await joinAs(t, owner.organizationId, `guest${counter}@tasks.com`, 'guest')
    const scope = t.data.asSystem(owner.organizationId)
    const workspace = await scope.workspaces.create({
      name: 'Deals',
      description: '',
      createdBy: owner.userId,
    })
    const start = (requestedBy: string, overrides: Partial<NewTask> = {}) =>
      scope.tasks.start({
        queue: 'test-export',
        kind: 'workspace.export',
        workspaceId: null,
        requestedBy,
        maxAttempts: 3,
        input: {},
        ...overrides,
      })
    return { owner, member, guest, scope, workspace, start }
  }

  const ids = (page: { tasks: { id: string }[] }) => page.tasks.map((task) => task.id).sort()

  it('answers a task as the contract shows it', async () => {
    const f = await organization()
    const row = await f.start(f.owner.userId, {
      label: 'Deals export',
      subject: { type: 'workspace', id: f.workspace.id },
    })
    await f.scope.tasks.begin(row.id, 0)
    await f.scope.tasks.progress(row.id, 3, 8)

    await expect(t.client(f.owner.headers).tasks.get({ id: row.id })).resolves.toEqual({
      id: row.id,
      kind: 'workspace.export',
      label: 'Deals export',
      workspaceId: null,
      subject: { type: 'workspace', id: f.workspace.id },
      status: 'running',
      attempts: 1,
      maxAttempts: 3,
      progress: { done: 3, total: 8 },
      errorCode: null,
      result: null,
      requestedById: f.owner.userId,
      requesterName: 'Olga',
      requestedByYou: true,
      createdAt: row.createdAt.toISOString(),
      startedAt: expect.any(String),
      finishedAt: null,
    })
  })

  it('shows everyone their own tasks, and every task to a role with task read', async () => {
    const f = await organization()
    const mine = await f.start(f.member.userId)
    const theirs = await f.start(f.owner.userId)

    const asMember = t.client(f.member.headers).tasks
    expect(ids(await asMember.list({ status: 'active' }))).toEqual([mine.id])
    await expect(asMember.get({ id: theirs.id })).rejects.toMatchObject({
      status: 404,
      message: NO_SUCH_TASK,
    })
    expect(ids(await t.client(f.owner.headers).tasks.list({ status: 'active' }))).toEqual(
      [mine.id, theirs.id].sort(),
    )
  })

  it('keeps workspace tasks to roles that read workspaces', async () => {
    const f = await organization()
    const organizationWide = await f.start(f.guest.userId)
    const inWorkspace = await f.start(f.guest.userId, { workspaceId: f.workspace.id })

    const asGuest = t.client(f.guest.headers).tasks
    expect(ids(await asGuest.list({ status: 'active' }))).toEqual([organizationWide.id])
    await expect(asGuest.get({ id: inWorkspace.id })).rejects.toMatchObject({ status: 404 })
    await expect(
      asGuest.list({ status: 'active', workspaceId: f.workspace.id }),
    ).rejects.toMatchObject({ status: 403 })

    const asOwner = t.client(f.owner.headers).tasks
    expect(ids(await asOwner.list({ status: 'active', workspaceId: f.workspace.id }))).toEqual([
      inWorkspace.id,
    ])
  })

  it('keeps organizations apart', async () => {
    const f = await organization()
    const other = await organization()
    const task = await f.start(f.owner.userId)
    await expect(t.client(other.owner.headers).tasks.get({ id: task.id })).rejects.toMatchObject({
      status: 404,
    })
    expect((await t.client(other.owner.headers).tasks.list({ status: 'active' })).tasks).toEqual([])
  })

  it('pages finished tasks newest first, and refuses a cursor it did not give', async () => {
    const f = await organization()
    for (let i = 0; i < 3; i += 1) {
      const task = await f.start(f.owner.userId)
      await f.scope.tasks.fail(task.id, 'unexpected')
    }
    const api = t.client(f.owner.headers).tasks
    const first = await api.list({ status: 'finished', limit: 2 })
    expect(first.tasks).toHaveLength(2)
    const second = await api.list({ status: 'finished', limit: 2, after: first.next! })
    expect(second).toMatchObject({ next: null })
    expect(second.tasks).toHaveLength(1)
    expect(new Set([...ids(first), ...ids(second)]).size).toBe(3)

    await expect(api.list({ status: 'finished', after: 'not-a-cursor' })).rejects.toMatchObject({
      status: 400,
      message: BAD_CURSOR,
    })
  })

  it('signals task changes as the contract declares them', async () => {
    const f = await organization()
    const row = await f.start(f.member.userId)
    await f.scope.tasks.begin(row.id, 0)

    const { rows } = await sqlOf(t)(
      'select event, payload from realtime.messages where starts_with(topic, $1)',
      [`org:${f.owner.organizationId}:`],
    )
    expect(rows).toHaveLength(4)
    for (const { event, payload } of rows) {
      expect(event).toBe(TASK_SIGNAL_EVENT)
      expect(taskSignalSchema.parse(payload)).toEqual({ taskId: row.id })
    }
  })
})
