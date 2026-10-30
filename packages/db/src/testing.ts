import { type Data, type OpenDataOptions, openData } from './open-data'
import { type MemoryJobs, memoryJobs } from './jobs/memory'
import { memoryStorage } from './storage/memory'

export { memoryJobs, sentJobs, type MemoryJobs, type SentJob } from './jobs/memory'
export { memoryStorage } from './storage/memory'
export { inProcessJobs } from './jobs/in-process'

/** Data plus the raw `db` and `storage` handles test set-up needs. */
export type TestData = Data & { jobs: MemoryJobs }

/** Opens a fresh in-memory database with migrations applied. Remember `await data.close()`. */
export async function openTestData(options: OpenDataOptions = {}): Promise<TestData> {
  const jobs = memoryJobs()
  const data = await openData(
    { pgliteDir: 'memory://' },
    { storage: memoryStorage(), jobs, ...options },
  )
  return data as TestData
}
