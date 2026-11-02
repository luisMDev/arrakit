import { WORKER_RETRY_POLICY } from '@arrakit/db'
import {
  type QueuedTestData,
  type TestData,
  insertOrganization,
  openTestData,
  openTestDataWithQueue,
} from '@arrakit/db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { type LogEntry, recordingLogger } from '../observability/logger'

import { STORAGE_PURGE, queueStoragePurge, registerStoragePurge } from './storage-purge'

describe('storage purge worker', () => {
  let data: TestData
  let orgId: string
  const { log, logs } = recordingLogger()
  const errors = () => logs.filter((entry: LogEntry) => entry.level === 'error')

  beforeAll(async () => {
    data = await openTestData()
    await registerStoragePurge(data, log)
    orgId = (await insertOrganization(data, { slug: 'purge-co' })).id
  })
  beforeEach(() => void logs.splice(0))
  afterAll(() => data.close())

  const files = () => data.forOrganization(orgId).files
  const paths = async () => (await files().list('')).map((file) => file.path)

  it('defines its queue with the worker retry policy', () => {
    expect(data.jobs.queues.get(STORAGE_PURGE)).toMatchObject(WORKER_RETRY_POLICY)
    expect(data.jobs.workers.has(STORAGE_PURGE)).toBe(true)
  })

  it('removes a folder, or the whole organization, through the queue', async () => {
    for (const path of ['companies/c1/a.pdf', 'companies/c1x/b.pdf', 'keep.txt']) {
      data.storage.put(orgId, path)
    }

    await queueStoragePurge(data.jobs, { organizationId: orgId, folder: 'companies/c1/' }, log)
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

  it('names the folder or the whole organization in its log lines', async () => {
    const jobs = { ...data.jobs, send: async () => Promise.reject(new Error('queue down')) }

    await expect(
      queueStoragePurge(jobs, { organizationId: orgId, folder: '' }, log),
    ).resolves.toBeUndefined()
    await queueStoragePurge(jobs, { organizationId: orgId, folder: 'companies/' }, log)

    const notQueued = 'storage purge not queued; its files stay in the bucket'
    expect(errors()).toEqual([
      expect.objectContaining({ msg: notQueued, organizationId: orgId, target: 'folder "<all>"' }),
      expect.objectContaining({
        msg: notQueued,
        organizationId: orgId,
        target: 'folder "companies/"',
      }),
    ])
  })
})

describe('storage purge on the real queue (pg-boss over PGlite)', () => {
  let data: QueuedTestData
  const { log } = recordingLogger()

  beforeAll(async () => {
    data = await openTestDataWithQueue()
    await registerStoragePurge(data, log)
  }, 60_000)
  afterAll(() => data.close())

  it('empties the organization folder once the queued job runs', async () => {
    const { id } = await insertOrganization(data, { slug: 'queued-purge-co' })
    data.storage.put(id, 'companies/c1/a.pdf')
    data.storage.put(id, 'keep.txt')
    const paths = async () =>
      (await data.forOrganization(id).files.list('')).map((file) => file.path)
    expect(await paths()).toHaveLength(2)

    await queueStoragePurge(data.jobs, { organizationId: id, folder: '' }, log)

    await vi.waitFor(async () => expect(await paths()).toEqual([]), {
      timeout: 20_000,
      interval: 100,
    })
  }, 30_000)
})
