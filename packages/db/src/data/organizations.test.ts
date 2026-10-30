import { randomUUID } from 'node:crypto'

import { eq, getTableColumns, getTableName, isTable } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { OrganizationNameUnusableError } from '../errors'
import * as schema from '../schema/index'
import {
  creditLedger,
  invitations,
  members,
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  organizations,
  sessions,
  usageLevels,
  users,
} from '../schema/index'
import { type TestData, openTestData } from '../testing'

describe('organizations', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  const organizationWithOwner = async (slug: string) => {
    const owner = randomUUID()
    await data.db.insert(users).values({ id: owner, name: '', email: `owner@${slug}.vc` })
    const [row] = await data.db.insert(organizations).values({ name: slug, slug }).returning()
    await data.db.insert(members).values({ organizationId: row!.id, userId: owner, role: 'owner' })
    return { id: row!.id, owner }
  }

  const grant = async (userId: string, organizationId: string) => {
    const clientId = `client-${randomUUID()}`
    await data.db.insert(oauthClients).values({ id: clientId, clientId, redirectUris: [] })
    const refreshId = randomUUID()
    await data.db.insert(oauthRefreshTokens).values({
      id: refreshId,
      token: randomUUID(),
      clientId,
      userId,
      referenceId: organizationId,
      scopes: [],
    })
    await data.db.insert(oauthAccessTokens).values({
      id: randomUUID(),
      clientId,
      userId,
      referenceId: organizationId,
      scopes: [],
    })
    await data.db
      .insert(oauthConsents)
      .values({ id: randomUUID(), clientId, userId, referenceId: organizationId, scopes: [] })
    return clientId
  }

  it('renames trimmed, keeps the slug, accepts names without slug characters, refuses blanks', async () => {
    const { id } = await organizationWithOwner('alder')
    const scope = data.forOrganization(id)
    expect(await scope.rename('  Alder Capital ')).toMatchObject({
      name: 'Alder Capital',
      slug: 'alder',
    })
    expect((await scope.rename('北京基金'))?.name).toBe('北京基金')
    expect((await scope.rename('&.!'))?.name).toBe('&.!')
    await expect(scope.rename('   ')).rejects.toBeInstanceOf(OrganizationNameUnusableError)
    expect((await scope.organization())?.name).toBe('&.!')
    expect(await data.forOrganization(randomUUID()).rename('Ghost')).toBeUndefined()
  })

  it('deletes an organization with its members, invitations and grants, keeping its people', async () => {
    const doomed = await organizationWithOwner('birch')
    const kept = await organizationWithOwner('cedar')
    await data.db.insert(invitations).values({
      organizationId: doomed.id,
      email: 'x@birch.vc',
      inviterId: doomed.owner,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    await data.db.insert(sessions).values({
      id: randomUUID(),
      token: randomUUID(),
      userId: doomed.owner,
      expiresAt: new Date(Date.now() + 86_400_000),
      activeOrganizationId: doomed.id,
    })
    const client = await grant(doomed.owner, doomed.id)
    await grant(kept.owner, kept.id)

    expect(await data.deleteOrganization(doomed.id.toUpperCase())).toBe(true)
    expect(await data.deleteOrganization(doomed.id)).toBe(false)
    expect(await data.memberOf(doomed.owner)).toBeNull()
    expect(await data.memberOf(kept.owner)).not.toBeNull()
    expect(
      await data.db.select().from(invitations).where(eq(invitations.organizationId, doomed.id)),
    ).toEqual([])
    expect(await data.db.select().from(users).where(eq(users.id, doomed.owner))).toHaveLength(1)
    const [owned] = await data.db.select().from(sessions).where(eq(sessions.userId, doomed.owner))
    expect(owned?.activeOrganizationId).toBeNull()
    for (const table of [oauthAccessTokens, oauthRefreshTokens, oauthConsents]) {
      expect(await data.db.select().from(table).where(eq(table.referenceId, doomed.id))).toEqual([])
      expect(await data.db.select().from(table).where(eq(table.referenceId, kept.id))).toHaveLength(
        1,
      )
    }
    expect(
      await data.db.select().from(oauthClients).where(eq(oauthClients.clientId, client)),
    ).toHaveLength(1)
  })

  it('refuses an id that is not a UUID before deleting anything', async () => {
    await expect(data.deleteOrganization('not-a-uuid')).rejects.toThrow(/not an organization id/)
    await expect(data.deleteOrganization('')).rejects.toThrow()
  })

  describe('cascade through every table that carries organization_id', () => {
    interface RawClient {
      query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
    }
    const raw = () => (data.db as unknown as { $client: RawClient }).$client

    /** Tables of the migrated database (not the Drizzle declarations) with an organization_id column. */
    const tenantTables = async () =>
      (
        await raw().query<{ table: string }>(
          `select table_name as "table" from information_schema.columns
           where table_schema = 'public' and column_name = 'organization_id'
           order by table_name`,
        )
      ).rows.map((row) => row.table)

    it('declares every organization_id as a NOT NULL FK to organizations ON DELETE CASCADE', async () => {
      const declared = Object.values(schema as Record<string, unknown>)
        .filter((value): value is PgTable => isTable(value))
        .filter((table) => 'organizationId' in getTableColumns(table))
        .map(getTableName)
        .sort()
      const tables = await tenantTables()
      expect(tables).toEqual(declared)
      expect(tables.length).toBeGreaterThan(0)

      const { rows } = await raw().query<{ table: string; column: string; onDelete: string }>(
        `select c.conrelid::regclass::text as "table", a.attname as "column",
                c.confdeltype as "onDelete"
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
         where c.contype = 'f' and c.confrelid = 'organizations'::regclass`,
      )
      const references = rows.map((row) => `${row.table}.${row.column}:${row.onDelete}`).sort()
      // 'c' = CASCADE; the only other reference is the session's active organization ('n' = SET NULL).
      expect(references).toEqual(
        [
          ...tables.map((table) => `${table}.organization_id:c`),
          'sessions.active_organization_id:n',
        ].sort(),
      )
      const { rows: nullable } = await raw().query<{ table: string }>(
        `select table_name as "table" from information_schema.columns
         where table_schema = 'public' and column_name = 'organization_id' and is_nullable = 'YES'`,
      )
      expect(nullable).toEqual([])
    })

    it('leaves no row of the deleted organization in any of them, keeping the others', async () => {
      const seed = async (slug: string) => {
        const organization = await organizationWithOwner(slug)
        const id = organization.id
        await data.db.insert(invitations).values({
          organizationId: id,
          email: `x@${slug}.vc`,
          inviterId: organization.owner,
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        await data.db.insert(creditLedger).values({
          organizationId: id,
          metric: 'requests',
          bucket: 'purchased',
          reason: 'purchase',
          amount: 10,
          idempotencyKey: `seed-${slug}`,
        })
        await data.db
          .insert(usageLevels)
          .values({ organizationId: id, metric: 'requests', value: 1 })
        return id
      }
      const doomed = await seed('walnut')
      const kept = await seed('willow')

      const countIn = async (table: string, organizationId: string) => {
        const { rows } = await raw().query<{ n: number }>(
          `select count(*)::int as n from "${table}" where organization_id = $1`,
          [organizationId],
        )
        return rows[0]?.n ?? 0
      }
      const tables = await tenantTables()
      // A new tenant table must get a row in seed() above, so this walk really covers it.
      const unseeded: string[] = []
      for (const table of tables) if ((await countIn(table, doomed)) === 0) unseeded.push(table)
      expect(unseeded).toEqual([])

      expect(await data.deleteOrganization(doomed)).toBe(true)
      for (const table of tables) {
        expect({ table, rows: await countIn(table, doomed) }).toEqual({ table, rows: 0 })
        expect(await countIn(table, kept)).toBeGreaterThan(0)
      }
    })
  })
})
