import { randomUUID } from 'node:crypto'

import type { OrganizationRole } from '@arrakit/address'
import type { Plan } from '@arrakit/plans'

import { type MemoryJobs, memoryJobs } from './jobs/memory'
import { type Data, type OpenDataOptions, openData } from './open-data'
import type { OrganizationRow } from './organization/organization'
import { members, organizations, users } from './schema/index'
import { type MemoryStorage, memoryStorage } from './storage/memory'

export { memoryJobs, sentJobs, type MemoryJobs, type SentJob } from './jobs/memory'
export { memoryStorage, type MemoryStorage } from './storage/memory'
export { inProcessJobs } from './jobs/in-process'

/** Data with the recording jobs fake and the in-memory storage. */
export type TestData = Data & { jobs: MemoryJobs; storage: MemoryStorage }

/** Opens a fresh in-memory database with migrations applied. Remember `await data.close()`. */
export async function openTestData(options: OpenDataOptions = {}): Promise<TestData> {
  const data = await openData(
    { pgliteDir: 'memory://' },
    { storage: memoryStorage(), jobs: memoryJobs(), ...options },
  )
  return data as TestData
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
  role: OrganizationRole,
): Promise<void> {
  await data.db.insert(members).values({ organizationId, userId, role })
}
