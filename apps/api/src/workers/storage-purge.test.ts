import {
  type QueuedTestData,
  type TestData,
  insertOrganization,
  openTestData,
  openTestDataWithQueue,
} from '@arrakit/db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { noErrorReporter } from '../observability/error-reporter'
import { type LogEntry, recordingLogger } from '../observability/logger'

import { registerJobs } from './job'
import { queueStoragePurge, storagePurge } from './storage-purge'

describe('storage purge worker', () => {
  let data: TestData
  let orgId: string
  const { log, logs } = recordingLogger()
  const errors = () => logs.filter((entry: LogEntry) => entry.level === 'error')

  beforeAll(async () => {
    data = await openTestData()
    await registerJobs([storagePurge], { data, log, errors: noErrorReporter })
    orgId = (await insertOrganization(data, { slug: 'purge-co' })).id
  })
  beforeEach(() => void logs.splice(0))
  afterAll(() => data.close())

  const files = () => data.forOrganization(orgId).files
  const paths = async () => (await files().list('')).map((file) => file.path)

  it('removes a folder, or the whole organization, through the queue', async () => {
    for (const path of ['companies/c1/a.pdf', 'companies/c1x/b.pdf', 'keep.txt']) {
      data.storage.put(orgId, path)
    }

    await queueStoragePurge(data.jobs, { organizationId: orgId, folder: 'companies/c1/' }, log)
    await data.jobs.run(storagePurge.name)
    expect(await paths()).toEqual(['companies/c1x/b.pdf', 'keep.txt'])

    await queueStoragePurge(data.jobs, { organizationId: orgId, folder: '' }, log)
    await data.jobs.run(storagePurge.name)
    expect(await paths()).toEqual([])
  })

  it('names the organization and folder when a purge fails', async () => {
    const worker = data.jobs.workers.get(storagePurge.name)!
    await expect(worker({ organizationId: orgId, folder: '../escape/' })).rejects.toThrow(
      'not a usable folder',
    )
    expect(errors()[0]).toMatchObject({
      msg: 'job failed; the queue retries it, then dead-letters it',
      job: 'storage-purge',
      organizationId: orgId,
      target: 'folder "../escape/"',
      err: { message: expect.stringContaining('not a usable folder') },
    })
  })

  it('names the folder or the whole organization when a purge is not queued', async () => {
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
    await registerJobs([storagePurge], { data, log, errors: noErrorReporter })
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
