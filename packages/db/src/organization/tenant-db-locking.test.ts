import { randomUUID } from 'node:crypto'

import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type Database, defaultMigrationsFolder } from '../connection'
import { memoryJobs } from '../jobs/memory'
import { type Data, openData } from '../open-data'
import { toOrganizationId } from '../organization-id'
import * as schema from '../schema/index'
import { invitations, organizations, users } from '../schema/index'
import { memoryStorage } from '../storage/memory'
import { type LockStrength, organizationDb } from './tenant-db'

/**
 * PGlite has one connection, so it cannot show one transaction waiting on another. The first
 * suite pins the lock clause in the emitted SQL; the Postgres suite proves a conflicting lock
 * waits and runs only when TEST_DATABASE_URL (or DATABASE_URL) points at a Postgres.
 */
describe('tenant lock() (emitted SQL)', () => {
  const queries: string[] = []
  let client: PGlite
  let db: Database
  let organizationId: string

  beforeAll(async () => {
    client = new PGlite()
    const logged = drizzle({ client, schema, logger: { logQuery: (query) => queries.push(query) } })
    await migrate(logged, { migrationsFolder: defaultMigrationsFolder() })
    db = logged as unknown as Database
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Locked', slug: `locked-${randomUUID()}` })
      .returning()
    organizationId = org!.id
  })
  afterAll(() => client.close())

  const strengths: [LockStrength, RegExp][] = [
    ['update', /for update\s*$/],
    ['no key update', /for no key update\s*$/],
    ['share', /for share\s*$/],
    ['key share', /for key share\s*$/],
  ]

  it.each(strengths)('emits FOR %s scoped to its own organization', async (strength, clause) => {
    const tenant = organizationDb(db, toOrganizationId(organizationId))
    queries.length = 0
    await tenant.transaction((tx) =>
      tx.table(invitations).lock((t, { eq }) => eq(t.status, 'pending'), strength),
    )
    const lock = queries.find((q) => q.startsWith('select') && q.includes('from "invitations"'))
    expect(lock).toMatch(clause)
    expect(lock).toMatch(/"invitations"\."organization_id" = \$1/)
  })
})

const postgresUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL

describe.skipIf(!postgresUrl)('tenant lock() under real Postgres concurrency', () => {
  let data: Data

  beforeAll(async () => {
    data = await openData(
      { databaseUrl: postgresUrl },
      { storage: memoryStorage(), jobs: memoryJobs() },
    )
  })
  afterAll(async () => {
    await data?.close()
  })

  it('makes a conflicting lock wait until the transaction holding the row ends', async () => {
    const [org] = await data.db
      .insert(organizations)
      .values({ name: 'Race', slug: `race-${randomUUID()}` })
      .returning()
    const [inviter] = await data.db
      .insert(users)
      .values({ id: randomUUID(), name: 'Race', email: `race-${randomUUID()}@example.com` })
      .returning()
    const tenant = data.forOrganization(org!.id)
    const [invitation] = await tenant.table(invitations).insert({
      email: `invitee-${randomUUID()}@example.com`,
      role: 'member',
      inviterId: inviter!.id,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const events: string[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    let markLocked!: () => void
    const locked = new Promise<void>((resolve) => (markLocked = resolve))
    const byId = (t: typeof invitations) => eq(t.id, invitation!.id)

    try {
      const first = tenant.transaction(async (tx) => {
        await tx.table(invitations).lock(byId, 'update')
        events.push('first locked')
        markLocked()
        await held
        events.push('first done')
      })
      await locked
      const second = tenant.transaction(async (tx) => {
        await tx.table(invitations).lock(byId, 'update')
        events.push('second locked')
      })
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(events).toEqual(['first locked'])
      release()
      await Promise.all([first, second])
      expect(events).toEqual(['first locked', 'first done', 'second locked'])
    } finally {
      release()
      await data.db.delete(organizations).where(eq(organizations.id, org!.id))
      await data.db.delete(users).where(eq(users.id, inviter!.id))
    }
  })
})
