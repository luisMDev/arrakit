import { TASK_EVENTS, WORKER_RETRY_POLICY } from '@arrakit/db'
import { type TestData, insertOrganization, insertUser, openTestData } from '@arrakit/db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { recordingErrorReporter } from '../observability/error-reporter'
import { type LogEntry, recordingLogger } from '../observability/logger'

import { JOBS, TRACKED_JOBS } from '.'
import { registerJobs } from './job'
import {
  PROGRESS_INTERVAL_MS,
  TASK_ERRORS,
  type TaskContext,
  TaskError,
  defineTrackedJob,
  startTask,
  trackedJob,
} from './tracked-job'

type Step = (context: TaskContext) => Promise<Record<string, unknown> | void>

describe('tracked jobs', () => {
  let data: TestData
  const { log, logs } = recordingLogger()
  const { errors, captured } = recordingErrorReporter()
  let clock = 0
  let step: Step = async () => {}
  const contexts: TaskContext[] = []

  const exporter = defineTrackedJob({
    name: 'test-export',
    kind: 'workspace.export',
    schema: z.object({ format: z.enum(['zip', 'tar']) }),
    policy: { ...WORKER_RETRY_POLICY, retryLimit: 2 },
    async handler(_input, context) {
      contexts.push(context)
      return step(context)
    },
  })

  beforeAll(async () => {
    data = await openTestData()
    await registerJobs([trackedJob(exporter, () => clock)], { data, log, errors })
  })
  beforeEach(async () => {
    step = async () => {}
    await data.jobs.run('test-export')
    logs.splice(0)
    captured.splice(0)
    contexts.splice(0)
  })
  afterAll(() => data.close())

  const organization = async (tag: string) => {
    const owner = await insertUser(data, `owner@${tag}.vc`)
    const { id } = await insertOrganization(data, { slug: tag })
    const scope = data.forOrganization(id)
    const start = () =>
      startTask(
        scope,
        exporter,
        { requestedBy: owner, workspaceId: null, label: 'Deals' },
        {
          format: 'zip',
        },
      )
    return { organizationId: id, scope, tasks: scope.tasks, start }
  }
  const eventsOf = (taskId: string) =>
    data.jobs.published
      .filter(({ data: payload }) => (payload as { taskId?: string }).taskId === taskId)
      .map(({ event }) => event)
  const errorLogs = () => logs.filter((entry: LogEntry) => entry.level === 'error')

  it('starts a task for the job, with its attempts, and queues the validated input', async () => {
    const f = await organization('alder')
    const task = await f.start()

    expect(task).toMatchObject({
      kind: 'workspace.export',
      label: 'Deals',
      status: 'queued',
      maxAttempts: 3,
    })
    expect(data.jobs.sent.at(-1)).toMatchObject({
      name: 'test-export',
      data: { taskId: task.id, organizationId: f.organizationId, input: { format: 'zip' } },
    })
    expect(() =>
      startTask(
        f.scope,
        exporter,
        { requestedBy: null, workspaceId: null },
        {
          format: 'rar' as 'zip',
        },
      ),
    ).toThrow(z.ZodError)
  })

  it('runs the task to success with its result, its progress and task.succeeded', async () => {
    const f = await organization('birch')
    const task = await f.start()
    step = async ({ progress, task: running }) => {
      expect(await f.tasks.get(running.id)).toMatchObject({ status: 'running', attempts: 1 })
      await progress(2, 4)
      return { url: 'exports/1.zip' }
    }
    await data.jobs.run('test-export')

    expect(contexts[0]!.task).toEqual({
      id: task.id,
      organizationId: f.organizationId,
      attempt: 1,
    })
    expect(await f.tasks.get(task.id)).toMatchObject({
      status: 'succeeded',
      progressDone: 4,
      progressTotal: 4,
      result: { url: 'exports/1.zip' },
    })
    expect(eventsOf(task.id)).toEqual([TASK_EVENTS.succeeded])
  })

  it('writes progress at most once per interval, and always once all is done', async () => {
    const f = await organization('cedar')
    const task = await f.start()
    const seen: (number | null)[] = []
    const record = async () => {
      seen.push((await f.tasks.get(task.id))!.progressDone)
    }
    step = async ({ progress }) => {
      clock = 10_000
      await progress(1, 10)
      await record()
      clock += PROGRESS_INTERVAL_MS - 1
      await progress(2)
      await record()
      clock += 1
      await progress(3)
      await record()
      await progress(10)
      await record()
    }
    await data.jobs.run('test-export')
    expect(seen).toEqual([1, 1, 3, 10])
  })

  it('waits as queued after a failed attempt, then retries it, reporting the error', async () => {
    const f = await organization('dogwood')
    const task = await f.start()
    step = async () => {
      throw new Error('disk full')
    }
    await expect(data.jobs.run('test-export')).rejects.toThrow('disk full')
    expect(await f.tasks.get(task.id)).toMatchObject({
      status: 'queued',
      attempts: 1,
      errorCode: TASK_ERRORS.unexpected,
    })
    expect(captured).toEqual([{ error: expect.any(Error), tags: { job: 'test-export' } }])
    expect(errorLogs()).toEqual([
      expect.objectContaining({ taskId: task.id, organizationId: f.organizationId }),
    ])

    step = async () => {}
    await data.jobs.run('test-export', { retryCount: 1 })
    expect(await f.tasks.get(task.id)).toMatchObject({
      status: 'succeeded',
      attempts: 2,
      errorCode: null,
    })
    expect(eventsOf(task.id)).toEqual([TASK_EVENTS.succeeded])
  })

  it('fails the task on its last attempt and publishes task.failed', async () => {
    const f = await organization('elm')
    const task = await f.start()
    step = async () => {
      throw new Error('still broken')
    }
    await expect(data.jobs.run('test-export', { retryCount: 2 })).rejects.toThrow('still broken')

    expect(await f.tasks.get(task.id)).toMatchObject({
      status: 'failed',
      attempts: 3,
      errorCode: TASK_ERRORS.unexpected,
    })
    expect(eventsOf(task.id)).toEqual([TASK_EVENTS.failed])
  })

  it('fails the task at once on a TaskError, without retrying or reporting it', async () => {
    const f = await organization('fir')
    const task = await f.start()
    step = async () => {
      throw new TaskError('too_large')
    }
    await expect(data.jobs.run('test-export')).resolves.toBeUndefined()

    expect(await f.tasks.get(task.id)).toMatchObject({ status: 'failed', errorCode: 'too_large' })
    expect(eventsOf(task.id)).toEqual([TASK_EVENTS.failed])
    expect(captured).toEqual([])
    expect(errorLogs()).toEqual([])
  })

  it('fails and dead-letters a task whose input the schema rejects', async () => {
    const f = await organization('ginkgo')
    const task = await f.start()
    const job = data.jobs.sent.at(-1)!
    const worker = data.jobs.workers.get('test-export')!
    await expect(worker({ ...job.data, input: { format: 'rar' } })).resolves.toBeUndefined()

    expect(contexts).toEqual([])
    expect(await f.tasks.get(task.id)).toMatchObject({
      status: 'failed',
      errorCode: TASK_ERRORS.invalidInput,
    })
    expect(data.jobs.sent.at(-1)).toMatchObject({ name: 'test-export__dead' })
    expect(errorLogs()).toEqual([
      expect.objectContaining({
        msg: 'task input invalid; failed and dead-lettered without retries',
      }),
    ])
  })

  it('does not run a task that is gone or already finished', async () => {
    const f = await organization('hazel')
    const task = await f.start()
    await f.tasks.fail(task.id, TASK_ERRORS.stalled)
    await data.jobs.run('test-export')

    expect(contexts).toEqual([])
    expect((await f.tasks.get(task.id))!.status).toBe('failed')
  })

  it('registers every tracked job under a name no other job takes', () => {
    const names = [...JOBS, ...TRACKED_JOBS].map((job) => job.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
