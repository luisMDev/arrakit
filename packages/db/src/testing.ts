import { randomUUID } from 'node:crypto'

import type { Plan } from '@arrakit/plans'
import { fromPglite } from 'pg-boss'

import type { Connection } from './connection'
import { type MemoryJobs, memoryJobs } from './jobs/memory'
import { pgBossJobs } from './jobs/pg-boss'
import { type Data, type OpenDataOptions, openDataOn } from './open-data'
import type { OrganizationRow } from './organization/index'
import type { MemberClaims } from './organization/scoped'
import { members, organizations, users } from './schema/index'
import { type MemoryStorage, memoryStorage } from './storage/memory'
import { pgliteTaskFeed } from './tasks/feed'
import { openTestDatabase } from './test-database'

export {
  type Claims,
  type MemberClaims,
  type Scoped,
  scopedTo,
  systemClaims,
} from './organization/scoped'

/** Data with the recording jobs fake and the in-memory storage. */
export type TestData = Data & { jobs: MemoryJobs; storage: MemoryStorage }

/** Data with real pg-boss jobs and the in-memory storage. */
export type QueuedTestData = Data & { storage: MemoryStorage }

async function testConnection(): Promise<Connection> {
  const { client, db } = await openTestDatabase()
  return {
    db,
    openJobs: (log) => pgBossJobs({ db: fromPglite(client), backend: 'pglite' }, log),
    openTaskFeed: (log) => pgliteTaskFeed(client, log),
    close: () => client.close(),
  }
}

/** Opens a fresh in-memory database with migrations applied. Remember `await data.close()`. */
export async function openTestData(options: OpenDataOptions = {}): Promise<TestData> {
  const data = await openDataOn(
    await testConnection(),
    {},
    { storage: memoryStorage(), jobs: memoryJobs(), ...options },
  )
  return data as TestData
}

/**
 * A fresh in-memory database whose jobs run on pg-boss over the same PGlite, the runtime the API
 * uses on Postgres. Slower than openTestData(): use it only to drive a job end to end.
 */
export async function openTestDataWithQueue(
  options: Omit<OpenDataOptions, 'jobs'> = {},
): Promise<QueuedTestData> {
  const data = await openDataOn(
    await testConnection(),
    {},
    { storage: memoryStorage(), ...options },
  )
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

interface RawClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

/** Raw SQL against the test database, for state no scope creates (backdated rows, queue tables). */
export function rawSql(data: Data) {
  const client = (data.db as unknown as { $client: RawClient }).$client
  return (text: string, params: unknown[] = []) => client.query(text, params)
}

/** The claims of a person acting in `organizationId` with `permissions` (`resource:action`). */
export function memberClaims(
  organizationId: string,
  userId: string,
  permissions: readonly string[] = [],
): MemberClaims {
  return { sub: userId, role: 'authenticated', org_id: organizationId, permissions, actor: 'user' }
}
