import { BYTES_PER_GB as GB } from '@arrakit/plans'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { transaction } from '../connection'
import { FILE_EVENTS } from '../files/events'
import { STORAGE_PURGE_QUEUE } from '../jobs/types'
import {
  type QueuedTestData,
  type TestData,
  insertOrganization,
  insertUser,
  openTestData,
  openTestDataWithQueue,
  rawSql,
} from '../testing'
import { objectPathOf, workspaceFolderOf } from './files'

const pdf = (name: string, sizeBytes = 10) => ({ name, contentType: 'application/pdf', sizeBytes })

describe('organization files', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
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
    return { owner, organizationId: organization.id, scope, files: scope.files, workspace }
  }
  const storageLevel = async (f: Awaited<ReturnType<typeof organizationOf>>) =>
    (await f.scope.usage.summary()).find((m) => m.metric === 'storage_gb')!.used

  it('lists only uploaded files of the scope asked, by name, with who uploaded them', async () => {
    const f = await organizationOf('alder')
    const zeta = await f.files.reserve({
      ...pdf('zeta.pdf'),
      workspaceId: null,
      uploadedBy: f.owner,
    })
    const alpha = await f.files.reserve({
      ...pdf('Alpha.pdf'),
      workspaceId: null,
      uploadedBy: f.owner,
    })
    await f.files.reserve({ ...pdf('pending.pdf'), workspaceId: null, uploadedBy: f.owner })
    const inWorkspace = await f.files.reserve({
      ...pdf('deal.pdf'),
      workspaceId: f.workspace.id,
      uploadedBy: f.owner,
    })
    for (const file of [zeta, alpha, inWorkspace]) await f.files.complete(file.id)

    const organizationFiles = await f.files.list(null)
    expect(organizationFiles.map((file) => file.name)).toEqual(['Alpha.pdf', 'zeta.pdf'])
    expect(organizationFiles[0]).toMatchObject({ status: 'ready', uploaderName: 'Owner alder' })
    expect((await f.files.list(f.workspace.id)).map((file) => file.name)).toEqual(['deal.pdf'])
  })

  it('keeps organizations apart', async () => {
    const f = await organizationOf('birch')
    const other = await organizationOf('cedar')
    const file = await f.files.reserve({ ...pdf('a.pdf'), workspaceId: null, uploadedBy: f.owner })

    expect(await other.files.get(file.id)).toBeUndefined()
    expect(await other.files.complete(file.id)).toBeUndefined()
    expect(await other.files.remove(file.id)).toBeUndefined()
    await expect(
      other.files.reserve({
        ...pdf('b.pdf'),
        workspaceId: f.workspace.id,
        uploadedBy: other.owner,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('refuses a name already uploaded in the same scope, ignoring case, but not elsewhere', async () => {
    const f = await organizationOf('dogwood')
    const first = await f.files.reserve({
      ...pdf('Deck.pdf'),
      workspaceId: null,
      uploadedBy: f.owner,
    })
    const racing = await f.files.reserve({
      ...pdf('deck.PDF'),
      workspaceId: null,
      uploadedBy: f.owner,
    })
    await f.files.complete(first.id)

    await expect(
      f.files.reserve({ ...pdf('DECK.pdf'), workspaceId: null, uploadedBy: f.owner }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(f.files.complete(racing.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      f.files.reserve({ ...pdf('deck.pdf'), workspaceId: f.workspace.id, uploadedBy: f.owner }),
    ).resolves.toMatchObject({ status: 'pending' })
  })

  it('counts pending and uploaded bytes against storage_gb and refuses what does not fit', async () => {
    const f = await organizationOf('elm')
    const big = await f.files.reserve({
      ...pdf('big.pdf', 9.5 * GB),
      workspaceId: null,
      uploadedBy: f.owner,
    })
    expect(await storageLevel(f)).toBe(10)
    await f.files.reserve({ ...pdf('small.pdf', 0.4 * GB), workspaceId: null, uploadedBy: f.owner })

    const tooMuch = f.files.reserve({
      ...pdf('more.pdf', GB),
      workspaceId: null,
      uploadedBy: f.owner,
    })
    await expect(tooMuch).rejects.toMatchObject({
      code: 'PAYMENT_REQUIRED',
      data: { metric: 'storage_gb', requested: 1, available: 0 },
    })

    await f.files.remove(big.id)
    expect(await storageLevel(f)).toBe(1)
  })

  it('renames an uploaded file only', async () => {
    const f = await organizationOf('fir')
    const file = await f.files.reserve({ ...pdf('a.pdf'), workspaceId: null, uploadedBy: f.owner })
    expect(await f.files.rename(file.id, 'b.pdf')).toBeUndefined()
    await f.files.complete(file.id)
    const taken = await f.files.reserve({ ...pdf('c.pdf'), workspaceId: null, uploadedBy: f.owner })
    await f.files.complete(taken.id)

    expect(await f.files.rename(file.id, 'b.pdf')).toMatchObject({ name: 'b.pdf' })
    await expect(f.files.rename(file.id, 'C.pdf')).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('publishes an event for each change of an uploaded file', async () => {
    const f = await organizationOf('ginkgo')
    const start = data.jobs.published.length
    const file = await f.files.reserve({
      ...pdf('a.pdf'),
      workspaceId: f.workspace.id,
      uploadedBy: f.owner,
    })
    await f.files.complete(file.id)
    await f.files.rename(file.id, 'b.pdf')
    await f.files.remove(file.id)
    const pending = await f.files.reserve({
      ...pdf('p.pdf'),
      workspaceId: null,
      uploadedBy: f.owner,
    })
    await f.files.remove(pending.id)

    const events = data.jobs.published.slice(start)
    expect(events.map((e) => e.event)).toEqual([
      FILE_EVENTS.uploaded,
      FILE_EVENTS.renamed,
      FILE_EVENTS.deleted,
    ])
    expect(events[0]!.data).toEqual({
      organizationId: f.organizationId,
      workspaceId: f.workspace.id,
      fileId: file.id,
      name: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10,
      uploadedBy: f.owner,
      occurredAt: expect.any(String),
    })
    expect(events[1]!.data).toMatchObject({ name: 'b.pdf', previousName: 'a.pdf' })
    expect(events.every((e) => e.options.tx)).toBe(true)
  })

  it('expires pending files created before a moment and frees their storage', async () => {
    const f = await organizationOf('hazel')
    const stale = await f.files.reserve({
      ...pdf('old.pdf', GB),
      workspaceId: null,
      uploadedBy: f.owner,
    })
    const done = await f.files.reserve({
      ...pdf('done.pdf'),
      workspaceId: null,
      uploadedBy: f.owner,
    })
    await f.files.complete(done.id)
    expect(await data.organizationsWithPendingFiles(new Date(Date.now() + 1000))).toContain(
      f.organizationId,
    )

    const expired = await f.files.expirePending(new Date(Date.now() + 1000))
    expect(expired.map((file) => file.id)).toEqual([stale.id])
    expect(await f.files.get(done.id)).toBeDefined()
    expect(await storageLevel(f)).toBe(1)
    expect(await data.organizationsWithPendingFiles(new Date(Date.now() + 1000))).not.toContain(
      f.organizationId,
    )
  })

  it('removing a workspace removes its files, frees their storage, publishes their deletion and queues their purge', async () => {
    const f = await organizationOf('ivy')
    const file = await f.files.reserve({
      ...pdf('a.pdf', 2 * GB),
      workspaceId: f.workspace.id,
      uploadedBy: f.owner,
    })
    await f.files.complete(file.id)
    expect(await storageLevel(f)).toBe(2)
    const start = data.jobs.published.length

    expect(await f.scope.workspaces.remove(f.workspace.id)).toBe(true)
    expect(await f.files.get(file.id)).toBeUndefined()
    expect(await storageLevel(f)).toBe(0)
    expect(data.jobs.published.slice(start).map((e) => e.event)).toEqual([FILE_EVENTS.deleted])
    expect(data.jobs.sent.at(-1)).toMatchObject({
      name: STORAGE_PURGE_QUEUE,
      data: { organizationId: f.organizationId, folder: workspaceFolderOf(f.workspace.id) },
      options: { tx: expect.anything() },
    })
    expect(await f.scope.workspaces.remove(f.workspace.id)).toBe(false)
  })

  it('keeps bytes under a per-scope path that a rename never changes', () => {
    expect(objectPathOf({ id: 'f1', workspaceId: null })).toBe('files/f1')
    expect(objectPathOf({ id: 'f1', workspaceId: 'w1' })).toBe('workspaces/w1/files/f1')
    expect(objectPathOf({ id: 'f1', workspaceId: 'w1' }).startsWith(workspaceFolderOf('w1'))).toBe(
      true,
    )
  })
})

describe('file events on pg-boss', () => {
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
    const queue = 'files_test_indexer'
    await data.jobs.defineQueue(queue, { retryLimit: 0, retryDelay: 0, retryBackoff: false })
    await data.jobs.subscribe(FILE_EVENTS.uploaded, queue)
    const owner = await insertUser(data, 'owner@juniper.vc')
    const organization = await insertOrganization(data, { slug: 'juniper' })
    const files = data.forOrganization(organization.id).files

    const kept = await files.reserve({ ...pdf('a.pdf'), workspaceId: null, uploadedBy: owner })
    await files.complete(kept.id)
    expect(await queued(queue)).toBe(1)

    await expect(
      transaction(data.db, async (tx) => {
        await data.jobs.publish(FILE_EVENTS.uploaded, { fileId: 'rolled-back' }, { tx })
        throw new Error('abort')
      }),
    ).rejects.toThrow('abort')
    expect(await queued(queue)).toBe(1)
  }, 60_000)
})
