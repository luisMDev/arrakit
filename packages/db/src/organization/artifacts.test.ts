import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ARTIFACT_EVENTS } from '../artifacts/events'
import { transaction } from '../connection'
import {
  type QueuedTestData,
  type TestData,
  insertMember,
  insertOrganization,
  insertUser,
  openTestData,
  openTestDataWithQueue,
  rawSql,
} from '../testing'

const report = (title: string, content = '<h1>Q3</h1>') => ({
  title,
  format: 'html' as const,
  content,
})

describe('organization artifacts', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  const organizationOf = async (tag: string) => {
    const owner = await insertUser(data, `owner@${tag}.vc`, `Owner ${tag}`)
    const organization = await insertOrganization(data, { slug: tag })
    await insertMember(data, organization.id, owner, 'owner')
    const scope = data.asSystem(organization.id)
    const workspace = await scope.workspaces.create({
      name: 'Deals',
      description: '',
      createdBy: owner,
    })
    return { owner, organizationId: organization.id, scope, artifacts: scope.artifacts, workspace }
  }

  it('creates an artifact with its first version and lists each scope apart', async () => {
    const f = await organizationOf('acacia')
    const { artifact, version } = await f.artifacts.create({
      ...report('Pipeline', 'año'),
      workspaceId: null,
      createdBy: f.owner,
    })
    await f.artifacts.create({
      ...report('Deal memo'),
      workspaceId: f.workspace.id,
      createdBy: f.owner,
    })

    expect(artifact).toMatchObject({ title: 'Pipeline', format: 'html', currentVersion: 1 })
    expect(version).toMatchObject({ number: 1, content: 'año', sizeBytes: 4, publishedBy: f.owner })
    const listed = await f.artifacts.list(null)
    expect(listed.map((a) => a.title)).toEqual(['Pipeline'])
    expect(listed[0]!.creatorName).toBe('Owner acacia')
    expect((await f.artifacts.list(f.workspace.id)).map((a) => a.title)).toEqual(['Deal memo'])
  })

  it('lists the most recently changed first', async () => {
    const f = await organizationOf('baobab')
    const older = await f.artifacts.create({
      ...report('Older'),
      workspaceId: null,
      createdBy: f.owner,
    })
    await f.artifacts.create({ ...report('Newer'), workspaceId: null, createdBy: f.owner })
    expect((await f.artifacts.list(null)).map((a) => a.title)).toEqual(['Newer', 'Older'])

    await f.artifacts.publish(older.artifact.id, { content: 'v2', publishedBy: f.owner })
    expect((await f.artifacts.list(null)).map((a) => a.title)).toEqual(['Older', 'Newer'])
  })

  it('publishes numbered versions and reads any of them', async () => {
    const f = await organizationOf('cypress')
    const { artifact } = await f.artifacts.create({
      ...report('Weekly', 'one'),
      workspaceId: null,
      createdBy: f.owner,
    })
    const second = await f.artifacts.publish(artifact.id, { content: 'two', publishedBy: f.owner })
    await f.artifacts.publish(artifact.id, { content: 'three', publishedBy: f.owner })

    expect(second).toMatchObject({ artifact: { currentVersion: 2 }, version: { number: 2 } })
    expect((await f.artifacts.get(artifact.id))!.currentVersion).toBe(3)
    expect((await f.artifacts.version(artifact.id))!.content).toBe('three')
    expect((await f.artifacts.version(artifact.id, 1))!.content).toBe('one')
    expect(await f.artifacts.version(artifact.id, 4)).toBeUndefined()
    const versions = await f.artifacts.versions(artifact.id)
    expect(versions.map((v) => v.number)).toEqual([3, 2, 1])
    expect(versions[0]).toMatchObject({ sizeBytes: 5, publisherName: 'Owner cypress' })
    expect(versions[0]).not.toHaveProperty('content')
  })

  it('keeps organizations apart', async () => {
    const f = await organizationOf('dogwood')
    const other = await organizationOf('ebony')
    const { artifact } = await f.artifacts.create({
      ...report('Secret'),
      workspaceId: null,
      createdBy: f.owner,
    })

    expect(await other.artifacts.get(artifact.id)).toBeUndefined()
    expect(await other.artifacts.version(artifact.id)).toBeUndefined()
    expect(await other.artifacts.versions(artifact.id)).toEqual([])
    expect(
      await other.artifacts.publish(artifact.id, { content: 'x', publishedBy: other.owner }),
    ).toBeUndefined()
    expect(await other.artifacts.rename(artifact.id, 'Mine')).toBeUndefined()
    expect(await other.artifacts.remove(artifact.id)).toBeUndefined()
    await expect(
      other.artifacts.create({
        ...report('Sneaky'),
        workspaceId: f.workspace.id,
        createdBy: other.owner,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await f.artifacts.get(artifact.id))!.title).toBe('Secret')
  })

  it('deletes an artifact with all its versions', async () => {
    const f = await organizationOf('fig')
    const { artifact } = await f.artifacts.create({
      ...report('Gone'),
      workspaceId: null,
      createdBy: f.owner,
    })
    await f.artifacts.publish(artifact.id, { content: 'v2', publishedBy: f.owner })

    expect(await f.artifacts.remove(artifact.id)).toMatchObject({ id: artifact.id })
    expect(await f.artifacts.get(artifact.id)).toBeUndefined()
    expect(await f.artifacts.versions(artifact.id)).toEqual([])
    expect(await f.artifacts.remove(artifact.id)).toBeUndefined()
  })

  it('publishes an event for each change, inside its transaction', async () => {
    const f = await organizationOf('guava')
    const start = data.jobs.published.length
    const { artifact } = await f.artifacts.create({
      ...report('Board pack', 'v1'),
      workspaceId: f.workspace.id,
      createdBy: f.owner,
    })
    await f.artifacts.publish(artifact.id, { content: 'v2!', publishedBy: f.owner })
    await f.artifacts.rename(artifact.id, 'Board pack Q3')
    await f.artifacts.remove(artifact.id)

    const events = data.jobs.published.slice(start)
    expect(events.map((e) => e.event)).toEqual([
      ARTIFACT_EVENTS.created,
      ARTIFACT_EVENTS.versionPublished,
      ARTIFACT_EVENTS.renamed,
      ARTIFACT_EVENTS.deleted,
    ])
    expect(events[0]!.data).toEqual({
      organizationId: f.organizationId,
      workspaceId: f.workspace.id,
      artifactId: artifact.id,
      title: 'Board pack',
      format: 'html',
      version: 1,
      createdBy: f.owner,
      sizeBytes: 2,
      publishedBy: f.owner,
      occurredAt: expect.any(String),
    })
    expect(events[1]!.data).toMatchObject({ version: 2, sizeBytes: 3, publishedBy: f.owner })
    expect(events[2]!.data).toMatchObject({
      title: 'Board pack Q3',
      previousTitle: 'Board pack',
      version: 2,
    })
    expect(events[3]!.data).toMatchObject({ title: 'Board pack Q3', version: 2 })
    expect(events.every((e) => e.options.tx)).toBe(true)
  })

  it('removing a workspace removes its artifacts and publishes their deletion', async () => {
    const f = await organizationOf('hawthorn')
    const { artifact } = await f.artifacts.create({
      ...report('In workspace'),
      workspaceId: f.workspace.id,
      createdBy: f.owner,
    })
    const kept = await f.artifacts.create({
      ...report('Organization wide'),
      workspaceId: null,
      createdBy: f.owner,
    })
    const start = data.jobs.published.length

    expect(await f.scope.workspaces.remove(f.workspace.id)).toBe(true)
    expect(await f.artifacts.get(artifact.id)).toBeUndefined()
    expect(await f.artifacts.get(kept.artifact.id)).toBeDefined()
    const events = data.jobs.published.slice(start)
    expect(events.map((e) => e.event)).toEqual([ARTIFACT_EVENTS.deleted])
    expect(events[0]!.data).toMatchObject({ artifactId: artifact.id })
    expect(await f.scope.workspaces.remove(f.workspace.id)).toBe(false)
  })
})

describe('artifact events on pg-boss', () => {
  let data: QueuedTestData

  beforeAll(async () => {
    data = await openTestDataWithQueue()
  }, 60_000)
  afterAll(() => data.close())

  const queued = async (queue: string) => {
    const { rows } = await rawSql(data)('select count(*) as n from pgboss.job where name = $1', [
      queue,
    ])
    return Number(rows[0]!.n)
  }

  it('queues an event for its subscribers only when the change commits', async () => {
    const queue = 'artifacts_test_notifier'
    await data.jobs.defineQueue(queue, { retryLimit: 0, retryDelay: 0, retryBackoff: false })
    await data.jobs.subscribe(ARTIFACT_EVENTS.created, queue)
    const owner = await insertUser(data, 'owner@ironwood.vc')
    const organization = await insertOrganization(data, { slug: 'ironwood' })
    const artifacts = data.asSystem(organization.id).artifacts

    await artifacts.create({ ...report('Kept'), workspaceId: null, createdBy: owner })
    expect(await queued(queue)).toBe(1)

    await expect(
      transaction(data.db, async (tx) => {
        await data.jobs.publish(ARTIFACT_EVENTS.created, { artifactId: 'rolled-back' }, { tx })
        throw new Error('abort')
      }),
    ).rejects.toThrow('abort')
    expect(await queued(queue)).toBe(1)
  }, 60_000)
})
