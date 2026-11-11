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

import { ARTIFACT_SUBSCRIBERS, defineArtifactSubscriber } from '../artifacts/subscribers'
import { FILE_SUBSCRIBERS, defineFileSubscriber } from '../files/subscribers'
import { noErrorReporter } from '../observability/error-reporter'
import { recordingLogger } from '../observability/logger'
import { TASK_SUBSCRIBERS, defineTaskSubscriber } from '../tasks/subscribers'

import { registerEventSubscribers, subscriberQueue } from './subscribers'

describe('event subscribers', () => {
  let data: TestData
  const { log } = recordingLogger()
  const indexed: FileEvent[] = []
  const finished: TaskEvent[] = []
  const republished: ArtifactVersionPublishedEvent[] = []
  const indexer = defineFileSubscriber({
    name: 'vector-index',
    event: FILE_EVENTS.uploaded,
    async handler(payload) {
      indexed.push(payload)
    },
  })
  const notifier = defineTaskSubscriber({
    name: 'notify',
    event: TASK_EVENTS.succeeded,
    async handler(payload) {
      finished.push(payload)
    },
  })

  const announcer = defineArtifactSubscriber({
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
    expect(subscriberQueue(indexer)).toBe('file.uploaded.vector-index')
    expect(subscriberQueue(notifier)).toBe('task.succeeded.notify')
    expect(subscriberQueue(announcer)).toBe('artifact.version_published.announce')
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
    const files = data.forOrganization(organizationId).files
    const file = await files.reserve({
      workspaceId: null,
      name: 'deck.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      uploadedBy: owner,
    })
    await files.complete(file.id)

    await data.jobs.run(subscriberQueue(indexer))
    expect(indexed).toEqual([
      expect.objectContaining({ organizationId, fileId: file.id, name: 'deck.pdf' }),
    ])
  })

  it('runs the subscriber with the event of a task that succeeded', async () => {
    const owner = await insertUser(data, 'owner@finisher.vc')
    const { id: organizationId } = await insertOrganization(data, { slug: 'finisher-co' })
    const tasks = data.forOrganization(organizationId).tasks
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

    await data.jobs.run(subscriberQueue(notifier))
    expect(finished).toEqual([
      expect.objectContaining({ organizationId, taskId: task.id, kind: 'workspace.export' }),
    ])
  })

  it('runs the subscriber with the event of a new artifact version', async () => {
    const owner = await insertUser(data, 'owner@reporter.vc')
    const { id: organizationId } = await insertOrganization(data, { slug: 'reporter-co' })
    const artifacts = data.forOrganization(organizationId).artifacts
    const { artifact } = await artifacts.create({
      workspaceId: null,
      title: 'Weekly',
      format: 'markdown',
      content: '# v1',
      createdBy: owner,
    })
    await artifacts.publish(artifact.id, { content: '# v2', publishedBy: owner })

    await data.jobs.run(subscriberQueue(announcer))
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
    await data.jobs.send(subscriberQueue(indexer), { fileId: 'not-an-event' })
    await data.jobs.run(subscriberQueue(indexer))
    expect(data.jobs.sent.at(-1)).toMatchObject({ name: 'file.uploaded.vector-index__dead' })
  })

  it('names every subscriber uniquely per event', () => {
    const queues = [...FILE_SUBSCRIBERS, ...TASK_SUBSCRIBERS, ...ARTIFACT_SUBSCRIBERS].map(
      subscriberQueue,
    )
    expect(new Set(queues).size).toBe(queues.length)
  })
})
