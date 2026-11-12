import { randomUUID } from 'node:crypto'

import type { Plan } from '@arrakit/plans'
import { sql } from 'drizzle-orm'
import { fromPglite } from 'pg-boss'

import type { Connection } from './connection'
import { type MemoryJobs, memoryJobs } from './jobs/memory'
import { pgBossJobs } from './jobs/pg-boss'
import { type Data, type OpenDataOptions, openDataOn } from './open-data'
import type { OrganizationRow } from './organization/index'
import { type Claims, type MemberClaims, scopedTo } from './organization/scoped'
import { members, organizations, users } from './schema/index'
import { type MemoryStorage, memoryStorage } from './storage/memory'
import { openTestDatabase } from './test-database'

export { memoryJobs } from './jobs/memory'
export { FILES_BUCKET } from './storage/supabase'
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

/**
 * How many Realtime messages a join to `topic` with `claims` (a token's payload) may read, checked
 * as Realtime does: under `authenticated` with the claims and `realtime.topic` set. Zero: refused.
 */
export function realtimeJoinSees(data: Data, claims: object, topic: string): Promise<number> {
  return scopedTo(
    data.db,
    claims as Claims,
  )(async (tx) => {
    await tx.execute(sql`select set_config('realtime.topic', ${topic}, true)`)
    const { rows } = (await tx.execute(
      sql`select count(*)::int as n from realtime.messages`,
    )) as unknown as { rows: { n: number }[] }
    return rows[0]!.n
  })
}

const STACK_VARIABLES = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'BETTER_AUTH_JWT_KEY',
] as const

export type StackEnv = Record<(typeof STACK_VARIABLES)[number], string>

/** Where the local Supabase stack answers, as `pnpm test:stack` hands it to the stack suite. */
export function stackEnv(env: Record<string, string | undefined> = process.env): StackEnv {
  const missing = STACK_VARIABLES.filter((name) => !env[name])
  if (missing.length > 0)
    throw new Error(
      `[stack] missing ${missing.join(', ')}: run \`pnpm test:stack\` from the repository root`,
    )
  return Object.fromEntries(STACK_VARIABLES.map((name) => [name, env[name]!])) as StackEnv
}
