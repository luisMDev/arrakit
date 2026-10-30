import { type TestData, openTestData } from '@arrakit/db/testing'
import { WORKER_RETRY_POLICY } from '@arrakit/db'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { STORAGE_PURGE, queueStoragePurge, registerStoragePurge } from './storage-purge'

const bytes = new TextEncoder().encode('x')

describe('storage purge worker', () => {
  let data: TestData
  let orgId: string

  beforeAll(async () => {
    data = await openTestData()
    await registerStoragePurge(data)
    orgId = (await data.createOrganization('Purge Co')).id
  })
  afterEach(() => vi.restoreAllMocks())
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

    await queueStoragePurge(data.jobs, { organizationId: orgId, folder: 'companies/c1/' })
    await data.jobs.run(STORAGE_PURGE)
    expect(await paths()).toEqual(['companies/c1x/b.pdf', 'keep.txt', 'notes.txt'])

    await queueStoragePurge(data.jobs, { organizationId: orgId, keys: ['notes.txt', 'gone.txt'] })
    await data.jobs.run(STORAGE_PURGE)
    expect(await paths()).toEqual(['companies/c1x/b.pdf', 'keep.txt'])

    await queueStoragePurge(data.jobs, { organizationId: orgId, folder: '' })
    await data.jobs.run(STORAGE_PURGE)
    expect(await paths()).toEqual([])
  })

  it('logs and rethrows a failing purge so the queue retries it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const worker = data.jobs.workers.get(STORAGE_PURGE)!
    await expect(worker({ organizationId: orgId, folder: '../escape/' })).rejects.toThrow(
      'not a usable folder',
    )
    expect(error.mock.calls[0]![0]).toBe(
      `organization ${orgId} folder "../escape/": purge failed; pg-boss retries it, then dead-letters it`,
    )
  })

  it('names every key and the whole organization in its log lines', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const jobs = { ...data.jobs, send: async () => Promise.reject(new Error('queue down')) }

    await expect(
      queueStoragePurge(jobs, { organizationId: orgId, folder: '' }),
    ).resolves.toBeUndefined()
    await queueStoragePurge(jobs, { organizationId: orgId, keys: ['a.pdf', 'b.pdf'] })

    expect(error.mock.calls.map((call) => call[0])).toEqual([
      `organization ${orgId} folder "<all>": deleted, but its storage purge was not queued; its files stay in the bucket`,
      `organization ${orgId} files a.pdf, b.pdf: deleted, but its storage purge was not queued; its files stay in the bucket`,
    ])
  })
})
