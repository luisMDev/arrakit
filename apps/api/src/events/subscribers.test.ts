import {
  ARTIFACT_EVENTS,
  type ArtifactVersionPublishedEvent,
  FILE_EVENTS,
  type FileEvent,
  TASK_EVENTS,
  type TaskEvent,
} from '@arrakit/db'
import { type TestData, insertOrganization, insertUser, openTestData } from '@arrakit/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { artifactEvents } from '../artifacts/events'
import { fileEvents } from '../files/events'
import { noErrorReporter } from '../observability/error-reporter'
import { recordingLogger } from '../observability/logger'
import { taskEvents } from '../tasks/events'
import { SUBSCRIBERS } from '../workers'

import { defineEventSubscriber, registerEventSubscribers } from './subscribers'

describe('event subscribers', () => {
  let data: TestData
  const { log } = recordingLogger()
  const indexed: FileEvent[] = []
  const finished: TaskEvent[] = []
  const republished: ArtifactVersionPublishedEvent[] = []
  const indexer = defineEventSubscriber(fileEvents, {
    name: 'vector-index',
    event: FILE_EVENTS.uploaded,
    async handler(payload) {
      indexed.push(payload)
    },
  })
  const notifier = defineEventSubscriber(taskEvents, {
    name: 'notify',
    event: TASK_EVENTS.succeeded,
    async handler(payload) {
      finished.push(payload)
    },
  })

  const announcer = defineEventSubscriber(artifactEvents, {
    name: 'announce',
    event: ARTIFACT_EVENTS.versionPublished,
    async handler(payload) {
      republished.push(payload)
    },
  })

  beforeAll(async () => {
    data = await openTestData()
    await registerEventSubscribers([indexer, notifier, announcer], {
      data,
      log,
      errors: noErrorReporter,
    })
  })
  afterAll(() => data.close())

  it('gives each subscriber its own queue, subscribed to its event', () => {
    expect(indexer.job.name).toBe('file.uploaded.vector-index')
    expect(notifier.job.name).toBe('task.succeeded.notify')
    expect(announcer.job.name).toBe('artifact.version_published.announce')
    expect(data.jobs.subscriptions.get(ARTIFACT_EVENTS.versionPublished)).toEqual(
      new Set(['artifact.version_published.announce']),
    )
    expect(data.jobs.queues.has('file.uploaded.vector-index')).toBe(true)
    expect(data.jobs.subscriptions.get(FILE_EVENTS.uploaded)).toEqual(
      new Set(['file.uploaded.vector-index']),
    )
    expect(data.jobs.subscriptions.get(TASK_EVENTS.succeeded)).toEqual(
      new Set(['task.succeeded.notify']),
    )
  })

  it('runs the subscriber with the event of a completed upload', async () => {
    const owner = await insertUser(data, 'owner@subscriber.vc')
    const { id: organizationId } = await insertOrganization(data, { slug: 'subscriber-co' })
    const files = data.asSystem(organizationId).files
    const file = await files.reserve({
      workspaceId: null,
      name: 'deck.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      uploadedBy: owner,
    })
    await files.complete(file.id)

    await data.jobs.run(indexer.job.name)
    expect(indexed).toEqual([
      expect.objectContaining({ organizationId, fileId: file.id, name: 'deck.pdf' }),
    ])
  })

  it('runs the subscriber with the event of a task that succeeded', async () => {
    const owner = await insertUser(data, 'owner@finisher.vc')
    const { id: organizationId } = await insertOrganization(data, { slug: 'finisher-co' })
    const tasks = data.asSystem(organizationId).tasks
    const task = await tasks.start({
      queue: 'export',
      kind: 'workspace.export',
      workspaceId: null,
      requestedBy: owner,
      maxAttempts: 1,
      input: {},
    })
    await tasks.begin(task.id, 0)
    await tasks.succeed(task.id)

    await data.jobs.run(notifier.job.name)
    expect(finished).toEqual([
      expect.objectContaining({ organizationId, taskId: task.id, kind: 'workspace.export' }),
    ])
  })

  it('runs the subscriber with the event of a new artifact version', async () => {
    const owner = await insertUser(data, 'owner@reporter.vc')
    const { id: organizationId } = await insertOrganization(data, { slug: 'reporter-co' })
    const artifacts = data.asSystem(organizationId).artifacts
    const { artifact } = await artifacts.create({
      workspaceId: null,
      title: 'Weekly',
      format: 'markdown',
      content: '# v1',
      createdBy: owner,
    })
    await artifacts.publish(artifact.id, { content: '# v2', publishedBy: owner })

    await data.jobs.run(announcer.job.name)
    expect(republished).toEqual([
      expect.objectContaining({
        organizationId,
        artifactId: artifact.id,
        version: 2,
        format: 'markdown',
        publishedBy: owner,
      }),
    ])
  })

  it('dead-letters an event payload that does not match the event', async () => {
    await data.jobs.send(indexer.job.name, { fileId: 'not-an-event' })
    await data.jobs.run(indexer.job.name)
    expect(data.jobs.sent.at(-1)).toMatchObject({ name: 'file.uploaded.vector-index__dead' })
  })

  it('types a subscriber, when type-checked, by its domain and its event', () => {
    defineEventSubscriber(fileEvents, {
      name: 'other-domain',
      // @ts-expect-error a task event is not one of the file events
      event: TASK_EVENTS.succeeded,
      async handler() {},
    })
    defineEventSubscriber(fileEvents, {
      name: 'other-event',
      event: FILE_EVENTS.uploaded,
      async handler(payload) {
        // @ts-expect-error only file.renamed carries the previous name
        void payload.previousName
      },
    })
  })

  it('names every subscriber uniquely per event', () => {
    const queues = SUBSCRIBERS.map(({ job }) => job.name)
    expect(new Set(queues).size).toBe(queues.length)
  })
})
