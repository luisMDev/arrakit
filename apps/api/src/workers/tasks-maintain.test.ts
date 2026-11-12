import { TASK_EVENTS } from '@arrakit/db'
import {
  type TestData,
  insertOrganization,
  insertUser,
  openTestData,
  rawSql,
} from '@arrakit/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { noErrorReporter } from '../observability/error-reporter'
import { recordingLogger } from '../observability/logger'

import { registerJobs } from './job'
import { tasksMaintain } from './tasks-maintain'
import { TASK_ERRORS } from './tracked-job'

describe('maintaining tasks', () => {
  let data: TestData
  const { log } = recordingLogger()

  beforeAll(async () => {
    data = await openTestData()
    await registerJobs([tasksMaintain], { data, log, errors: noErrorReporter })
  })
  afterAll(() => data.close())

  it('runs on a schedule', () => {
    expect(data.jobs.schedules.get(tasksMaintain.name)?.cron).toBe('*/15 * * * *')
  })

  it('fails stalled tasks with task.failed, removes old finished ones and keeps the rest', async () => {
    const owner = await insertUser(data, 'owner@maintain.vc')
    const { id: organizationId } = await insertOrganization(data, { slug: 'maintain-co' })
    const tasks = data.asSystem(organizationId).tasks
    const start = () =>
      tasks.start({
        queue: 'export',
        kind: 'workspace.export',
        workspaceId: null,
        requestedBy: owner,
        maxAttempts: 1,
        input: {},
      })
    const running = async () => {
      const task = await start()
      await tasks.begin(task.id, 0)
      return task
    }
    const silent = await running()
    const lively = await running()
    const forgotten = await start()
    const waiting = await start()
    const old = await running()
    await tasks.succeed(old.id)
    const recent = await running()
    await tasks.succeed(recent.id)
    const age = (ids: string[], column: string, interval: string) =>
      rawSql(data)(
        `update tasks set ${column} = now() - interval '${interval}' where id = any($1::uuid[])`,
        [ids],
      )
    await age([silent.id], 'updated_at', '11 minutes')
    await age([lively.id], 'updated_at', '9 minutes')
    await age([forgotten.id], 'updated_at', '25 hours')
    await age([waiting.id], 'updated_at', '23 hours')
    await age([old.id], 'finished_at', '31 days')
    await age([recent.id], 'finished_at', '29 days')
    const published = data.jobs.published.length

    await data.jobs.send(tasksMaintain.name, {})
    await data.jobs.run(tasksMaintain.name)

    for (const id of [silent.id, forgotten.id]) {
      expect(await tasks.get(id)).toMatchObject({
        status: 'failed',
        errorCode: TASK_ERRORS.stalled,
      })
    }
    expect((await tasks.get(lively.id))!.status).toBe('running')
    expect((await tasks.get(waiting.id))!.status).toBe('queued')
    expect(await tasks.get(old.id)).toBeUndefined()
    expect((await tasks.get(recent.id))!.status).toBe('succeeded')
    expect(data.jobs.published.slice(published).map((event) => event.event)).toEqual([
      TASK_EVENTS.failed,
      TASK_EVENTS.failed,
    ])
  })
})
