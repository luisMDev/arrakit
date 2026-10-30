import { randomUUID } from 'node:crypto'

import { eq, getTableColumns, getTableName, isTable } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '../schema/index'
import {
  creditLedger,
  invitations,
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  organizationRoles,
  organizations,
  sessions,
  teamMembers,
  teams,
  usageLevels,
  users,
} from '../schema/index'
import {
  type TestData,
  insertMember,
  insertOrganization,
  insertUser,
  openTestData,
} from '../testing'

describe('organizations', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  const organizationWithOwner = async (slug: string) => {
    const owner = await insertUser(data, `owner@${slug}.vc`)
    const { id } = await insertOrganization(data, { slug })
    await insertMember(data, id, owner, 'owner')
    return { id, owner }
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

  const deleteOrganization = (id: string) =>
    data.db.delete(organizations).where(eq(organizations.id, id))

  it("revokes an organization's grants, or one person's, keeping other organizations' and the clients", async () => {
    const doomed = await organizationWithOwner('birch')
    const kept = await organizationWithOwner('cedar')
    const other = await insertUser(data, 'other@birch.vc')
    await insertMember(data, doomed.id, other, 'member')
    const client = await grant(doomed.owner, doomed.id)
    await grant(other, doomed.id)
    await grant(kept.owner, kept.id)

    await data.revokeGrants(doomed.id, other)
    const grantsOf = (table: typeof oauthAccessTokens, organizationId: string) =>
      data.db.select().from(table).where(eq(table.referenceId, organizationId))
    expect((await grantsOf(oauthAccessTokens, doomed.id)).map((row) => row.userId)).toEqual([
      doomed.owner,
    ])

    await data.revokeGrants(doomed.id.toUpperCase())
    for (const table of [oauthAccessTokens, oauthRefreshTokens, oauthConsents]) {
      expect(await data.db.select().from(table).where(eq(table.referenceId, doomed.id))).toEqual([])
      expect(await data.db.select().from(table).where(eq(table.referenceId, kept.id))).toHaveLength(
        1,
      )
    }
    expect(
      await data.db.select().from(oauthClients).where(eq(oauthClients.clientId, client)),
    ).toHaveLength(1)
    await expect(data.revokeGrants('not-a-uuid')).rejects.toThrow(/not an organization id/)
  })

  it('deleting an organization clears it from sessions and empties its teams, keeping its people', async () => {
    const doomed = await organizationWithOwner('alder')
    const sessionId = randomUUID()
    const [team] = await data.db
      .insert(teams)
      .values({ name: 'Ops', organizationId: doomed.id })
      .returning()
    await data.db.insert(teamMembers).values({ teamId: team!.id, userId: doomed.owner })
    await data.db.insert(sessions).values({
      id: sessionId,
      token: randomUUID(),
      userId: doomed.owner,
      expiresAt: new Date(Date.now() + 86_400_000),
      activeOrganizationId: doomed.id,
      activeTeamId: team!.id,
    })

    await deleteOrganization(doomed.id)
    const [session] = await data.db.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(session).toMatchObject({ activeOrganizationId: null, activeTeamId: null })
    expect(
      await data.db.select().from(teamMembers).where(eq(teamMembers.teamId, team!.id)),
    ).toEqual([])
    expect(await data.memberOf(doomed.owner)).toBeNull()
    expect(await data.db.select().from(users).where(eq(users.id, doomed.owner))).toHaveLength(1)
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
      // 'c' = CASCADE, 'n' = SET NULL (a session only points at its active organization).
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
        await data.db.insert(teams).values({ name: 'Ops', organizationId: id })
        await data.db
          .insert(organizationRoles)
          .values({ organizationId: id, role: 'finance', permission: '{"billing":["read"]}' })
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

      await deleteOrganization(doomed)
      for (const table of tables) {
        expect({ table, rows: await countIn(table, doomed) }).toEqual({ table, rows: 0 })
        expect(await countIn(table, kept)).toBeGreaterThan(0)
      }
    })
  })
})
