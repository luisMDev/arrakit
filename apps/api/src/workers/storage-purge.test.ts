import { type TestData, openTestData } from '@arrakit/db/testing'
import { WORKER_RETRY_POLICY } from '@arrakit/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type LogEntry, recordingLogger } from '../observability/logger'

import { STORAGE_PURGE, queueStoragePurge, registerStoragePurge } from './storage-purge'

const bytes = new TextEncoder().encode('x')

describe('storage purge worker', () => {
  let data: TestData
  let orgId: string
  const { log, logs } = recordingLogger()
  const errors = () => logs.filter((entry: LogEntry) => entry.level === 'error')

  beforeAll(async () => {
    data = await openTestData()
    await registerStoragePurge(data, log)
    orgId = (await data.createOrganization('Purge Co')).id
  })
  beforeEach(() => void logs.splice(0))
  afterAll(() => data.close())

  const files = () => data.forOrganization(orgId).files
  const paths = async () => (await files().list('')).map((file) => file.path)

  it('defines its queue with the worker retry policy', () => {
    expect(data.jobs.queues.get(STORAGE_PURGE)).toMatchObject(WORKER_RETRY_POLICY)
    expect(data.jobs.workers.has(STORAGE_PURGE)).toBe(true)
  })

  it('removes a folder, or only the keys named, through the queue', async () => {
    await files().put('companies/c1/a.pdf', bytes, 'application/pdf')
    await files().put('companies/c1x/b.pdf', bytes, 'application/pdf')
    await files().put('notes.txt', bytes, 'text/plain')
    await files().put('keep.txt', bytes, 'text/plain')

    await queueStoragePurge(data.jobs, { organizationId: orgId, folder: 'companies/c1/' }, log)
    await data.jobs.run(STORAGE_PURGE)
    expect(await paths()).toEqual(['companies/c1x/b.pdf', 'keep.txt', 'notes.txt'])

    await queueStoragePurge(
      data.jobs,
      { organizationId: orgId, keys: ['notes.txt', 'gone.txt'] },
      log,
    )
    await data.jobs.run(STORAGE_PURGE)
    expect(await paths()).toEqual(['companies/c1x/b.pdf', 'keep.txt'])

    await queueStoragePurge(data.jobs, { organizationId: orgId, folder: '' }, log)
    await data.jobs.run(STORAGE_PURGE)
    expect(await paths()).toEqual([])
  })

  it('logs and rethrows a failing purge so the queue retries it', async () => {
    const worker = data.jobs.workers.get(STORAGE_PURGE)!
    await expect(worker({ organizationId: orgId, folder: '../escape/' })).rejects.toThrow(
      'not a usable folder',
    )
    expect(errors()[0]).toMatchObject({
      msg: 'storage purge failed; the queue retries it, then dead-letters it',
      organizationId: orgId,
      target: 'folder "../escape/"',
      err: { message: expect.stringContaining('not a usable folder') },
    })
  })

  it('names every key and the whole organization in its log lines', async () => {
    const jobs = { ...data.jobs, send: async () => Promise.reject(new Error('queue down')) }

    await expect(
      queueStoragePurge(jobs, { organizationId: orgId, folder: '' }, log),
    ).resolves.toBeUndefined()
    await queueStoragePurge(jobs, { organizationId: orgId, keys: ['a.pdf', 'b.pdf'] }, log)

    const notQueued = 'storage purge not queued; its files stay in the bucket'
    expect(errors()).toEqual([
      expect.objectContaining({ msg: notQueued, organizationId: orgId, target: 'folder "<all>"' }),
      expect.objectContaining({
        msg: notQueued,
        organizationId: orgId,
        target: 'files a.pdf, b.pdf',
      }),
    ])
  })
})
