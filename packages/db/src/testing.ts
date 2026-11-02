import { randomUUID } from 'node:crypto'

import type { Plan } from '@arrakit/plans'

import { type MemoryJobs, memoryJobs } from './jobs/memory'
import { type Data, type OpenDataOptions, openData } from './open-data'
import type { OrganizationRow } from './organization/index'
import { members, organizations, users } from './schema/index'
import { type MemoryStorage, memoryStorage } from './storage/memory'

/** Data with the recording jobs fake and the in-memory storage. */
export type TestData = Data & { jobs: MemoryJobs; storage: MemoryStorage }

/** Data with real pg-boss jobs and the in-memory storage. */
export type QueuedTestData = Data & { storage: MemoryStorage }

/** Opens a fresh in-memory database with migrations applied. Remember `await data.close()`. */
export async function openTestData(options: OpenDataOptions = {}): Promise<TestData> {
  const data = await openData(
    { pgliteDir: 'memory://' },
    { storage: memoryStorage(), jobs: memoryJobs(), ...options },
  )
  return data as TestData
}

/**
 * A fresh in-memory database whose jobs run on pg-boss over the same PGlite, as `pnpm dev` does.
 * Slower than openTestData(): use it only to drive a job end to end.
 */
export async function openTestDataWithQueue(
  options: Omit<OpenDataOptions, 'jobs'> = {},
): Promise<QueuedTestData> {
  const data = await openData({ pgliteDir: 'memory://' }, { storage: memoryStorage(), ...options })
  return data as QueuedTestData
}

/** Inserts a person and returns their id. */
export async function insertUser(data: Data, email: string, name = ''): Promise<string> {
  const id = randomUUID()
  await data.db.insert(users).values({ id, name, email })
  return id
}

export async function insertOrganization(
  data: Data,
  options: { slug: string; name?: string; plan?: Plan; createdAt?: Date; usageAnchor?: Date },
): Promise<OrganizationRow> {
  const { slug, name = slug, ...rest } = options
  const [row] = await data.db
    .insert(organizations)
    .values({ slug, name, ...rest })
    .returning()
  return row!
}

export async function insertMember(
  data: Data,
  organizationId: string,
  userId: string,
  role: string,
): Promise<void> {
  await data.db.insert(members).values({ organizationId, userId, role })
}
