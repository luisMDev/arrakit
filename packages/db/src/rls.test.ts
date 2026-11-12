import { randomUUID } from 'node:crypto'

import { type SQL, and, eq, getTableName, isTable, sql } from 'drizzle-orm'
import { type PgTable, getTableConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from './connection'
import { isInsufficientPrivilege } from './errors'
import * as schema from './schema/index'
import {
  artifactVersions,
  artifacts,
  creditLedger,
  files,
  invitations,
  members,
  organizationRoles,
  organizations,
  tasks,
  teamMembers,
  teams,
  usageLevels,
  users,
  workspaces,
} from './schema/index'
import {
  type Claims,
  type TestData,
  insertMember,
  insertOrganization,
  insertUser,
  memberClaims,
  openTestData,
  rawSql,
  scopedTo,
  systemClaims,
} from './testing'

const tables = Object.values(schema as Record<string, unknown>).filter((value): value is PgTable =>
  isTable(value),
)
const exceptions: readonly string[] = schema.TENANCY_EXCEPTIONS
const tenantTableNames = tables
  .map(getTableName)
  .filter((name) => !exceptions.includes(name))
  .sort()
const publicTables = tables.filter((table) => getTableConfig(table).schema === undefined)
const betterAuthTables = tables.filter((table) => getTableConfig(table).schema === 'better_auth')

/** Every permission a policy names. */
const ALL_PERMISSIONS = [
  'workspace:create',
  'workspace:update',
  'workspace:delete',
  'file:upload',
  'file:update',
  'file:delete',
  'artifact:create',
  'artifact:update',
  'artifact:delete',
  'billing:manage',
]

async function rowsOf<T = Record<string, unknown>>(db: Database, query: SQL): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows
}

/** What a refused statement threw, or `undefined` when it went through. */
async function failureOf(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work()
    return undefined
  } catch (err) {
    return err
  }
}

interface Tenant {
  organizationId: string
  userId: string
  workspaceId: string
  artifactId: string
}

/** One fresh row per call for each tenant table, in the organization of `tenant`. */
const fixtures: Record<
  string,
  { table: PgTable; row: (tenant: Tenant) => Record<string, unknown> }
> = {
  members: {
    table: members,
    row: (t) => ({ organizationId: t.organizationId, userId: t.userId, role: 'member' }),
  },
  invitations: {
    table: invitations,
    row: (t) => ({
      organizationId: t.organizationId,
      email: `${randomUUID()}@invited.test`,
      inviterId: t.userId,
      expiresAt: new Date(Date.now() + 86_400_000),
    }),
  },
  teams: {
    table: teams,
    row: (t) => ({ organizationId: t.organizationId, name: `Team ${randomUUID()}` }),
  },
  organization_roles: {
    table: organizationRoles,
    row: (t) => ({ organizationId: t.organizationId, role: randomUUID(), permission: '{}' }),
  },
  workspaces: {
    table: workspaces,
    row: (t) => ({ organizationId: t.organizationId, name: `Workspace ${randomUUID()}` }),
  },
  files: {
    table: files,
    row: (t) => ({
      organizationId: t.organizationId,
      workspaceId: t.workspaceId,
      name: `${randomUUID()}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 10,
      uploadedBy: t.userId,
    }),
  },
  artifacts: {
    table: artifacts,
    row: (t) => ({
      organizationId: t.organizationId,
      title: 'Report',
      format: 'markdown',
      createdBy: t.userId,
    }),
  },
  artifact_versions: {
    table: artifactVersions,
    row: (t) => ({
      organizationId: t.organizationId,
      artifactId: t.artifactId,
      number: Math.floor(Math.random() * 1_000_000) + 2,
      content: '# Report',
      sizeBytes: 8,
      publishedBy: t.userId,
    }),
  },
  tasks: {
    table: tasks,
    row: (t) => ({ organizationId: t.organizationId, kind: 'test', maxAttempts: 1 }),
  },
  credit_ledger: {
    table: creditLedger,
    row: (t) => ({
      organizationId: t.organizationId,
      metric: 'ai_credits',
      bucket: 'plan',
      reason: 'consumption',
      amount: -1,
      idempotencyKey: randomUUID(),
    }),
  },
  usage_levels: {
    table: usageLevels,
    row: (t) => ({ organizationId: t.organizationId, metric: randomUUID(), value: 1 }),
  },
}

describe('row level security', () => {
  let data: TestData
  let a: Tenant
  let b: Tenant
  let outsider: string

  const run = <R>(claims: Claims, work: (tx: Database) => Promise<R>) =>
    scopedTo(data.db, claims)(work)
  const raw = (text: string, params: unknown[] = []) => rawSql(data)(text, params)

  async function tenant(slug: string): Promise<Tenant> {
    const organizationId = (await insertOrganization(data, { slug })).id
    const userId = await insertUser(data, `owner@${slug}.test`, `Owner ${slug}`)
    const [workspace] = await data.db
      .insert(workspaces)
      .values({ organizationId, name: 'Seed' })
      .returning()
    const [artifact] = await data.db
      .insert(artifacts)
      .values({ organizationId, title: 'Seed', format: 'markdown', createdBy: userId })
      .returning()
    return { organizationId, userId, workspaceId: workspace!.id, artifactId: artifact!.id }
  }

  async function seed(t: Tenant) {
    for (const [name, fixture] of Object.entries(fixtures)) {
      if (name === 'workspaces' || name === 'artifacts') continue
      await data.db.insert(fixture.table).values(fixture.row(t) as never)
    }
  }

  beforeAll(async () => {
    data = await openTestData()
    a = await tenant('alpha')
    b = await tenant('beta')
    await seed(a)
    await seed(b)
    outsider = await insertUser(data, 'outsider@nowhere.test', 'Outsider')
    for (const t of [a, b]) {
      const [team] = await data.db
        .insert(teams)
        .values({ organizationId: t.organizationId, name: 'Core' })
        .returning()
      await data.db.insert(teamMembers).values({ teamId: team!.id, userId: t.userId })
    }
  })
  afterAll(() => data.close())

  describe('catalog', () => {
    it('turns RLS on for every table of public and better_auth', async () => {
      const { rows } = await raw(
        `select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where c.relkind = 'r' and n.nspname in ('public', 'better_auth') and not c.relrowsecurity`,
      )
      expect(rows).toEqual([])
    })

    it('holds exactly the policies the schema declares, all for authenticated', async () => {
      const declared = tables
        .flatMap((table) => getTableConfig(table).policies.map((policy) => policy.name))
        .sort()
      const { rows } = await raw(
        `select policyname, roles::text as roles from pg_policies
         where schemaname in ('public', 'better_auth') order by policyname`,
      )
      expect(rows.map((row) => row.policyname)).toEqual(declared)
      expect(new Set(rows.map((row) => row.roles))).toEqual(new Set(['{authenticated}']))
    })

    const tablePrivileges = async (role: string) => {
      const { rows } = await raw(
        `select n.nspname as schema, c.relname as name,
                string_agg(acl.privilege_type, ',' order by acl.privilege_type) as privileges
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join lateral aclexplode(c.relacl) acl
         where c.relkind = 'r' and n.nspname in ('public', 'better_auth')
           and acl.grantee = $1::regrole
         group by 1, 2 order by 1, 2`,
        [role],
      )
      return rows
    }
    const columnPrivileges = async (role: string) => {
      const { rows } = await raw(
        `select n.nspname as schema, c.relname as name, a.attname as column, acl.privilege_type
         from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         join pg_namespace n on n.oid = c.relnamespace
         cross join lateral aclexplode(a.attacl) acl
         where n.nspname in ('public', 'better_auth') and acl.grantee = $1::regrole
         order by 1, 2, 3`,
        [role],
      )
      return rows
    }

    it('gives anon nothing', async () => {
      expect(await tablePrivileges('anon')).toEqual([])
      expect(await columnPrivileges('anon')).toEqual([])
    })

    it('gives authenticated plain DML on public and the four user columns in better_auth', async () => {
      expect(await tablePrivileges('authenticated')).toEqual(
        publicTables
          .map(getTableName)
          .sort()
          .map((name) => ({ schema: 'public', name, privileges: 'DELETE,INSERT,SELECT,UPDATE' })),
      )
      expect(await columnPrivileges('authenticated')).toEqual(
        ['email', 'id', 'image', 'name'].map((column) => ({
          schema: 'better_auth',
          name: 'users',
          column,
          privilege_type: 'SELECT',
        })),
      )
    })

    it('lets only authenticated run the app helpers', async () => {
      const { rows } = await raw(
        `select has_function_privilege('anon', 'app.org_id()', 'execute') as anon,
                has_function_privilege('authenticated', 'app.org_id()', 'execute') as authenticated`,
      )
      expect(rows).toEqual([{ anon: false, authenticated: true }])
    })
  })

  describe('isolation of every tenant table', () => {
    it('has a fixture for every tenant table', () => {
      expect(Object.keys(fixtures).sort()).toEqual(tenantTableNames)
    })

    const actors: [string, () => Claims][] = [
      ['the system actor', () => systemClaims(a.organizationId)],
      [
        'a member holding every permission',
        () => memberClaims(a.organizationId, a.userId, ALL_PERMISSIONS),
      ],
    ]

    for (const [actor, claimsOf] of actors) {
      for (const name of Object.keys(fixtures)) {
        it(`keeps ${name} of another organization out of reach of ${actor}`, async () => {
          const { table, row } = fixtures[name]!
          const count = async (organizationId: string) =>
            (
              await rowsOf<{ n: number }>(
                data.db,
                sql`select count(*)::int as n from ${table} where organization_id = ${organizationId}`,
              )
            )[0]!.n
          const before = await count(b.organizationId)
          const claims = claimsOf()

          const visible = await run(claims, (tx) =>
            rowsOf<{ organization_id: string }>(tx, sql`select organization_id from ${table}`),
          )
          expect(visible.length).toBeGreaterThan(0)
          expect(new Set(visible.map((r) => r.organization_id))).toEqual(
            new Set([a.organizationId]),
          )

          const updated = await run(claims, (tx) =>
            rowsOf(
              tx,
              sql`update ${table} set organization_id = organization_id
                  where organization_id = ${b.organizationId} returning 1`,
            ),
          )
          expect(updated).toEqual([])
          const deleted = await run(claims, (tx) =>
            rowsOf(
              tx,
              sql`delete from ${table} where organization_id = ${b.organizationId} returning 1`,
            ),
          )
          expect(deleted).toEqual([])

          const inserted = await failureOf(() =>
            run(claims, (tx) => tx.insert(table).values(row(b) as never)),
          )
          expect(isInsufficientPrivilege(inserted)).toBe(true)

          let moved: unknown[] = []
          const moving = await failureOf(async () => {
            moved = await run(claims, (tx) =>
              rowsOf(
                tx,
                sql`update ${table} set organization_id = ${b.organizationId}
                    where organization_id = ${a.organizationId} returning 1`,
              ),
            )
          })
          if (moving !== undefined) expect(isInsufficientPrivilege(moving)).toBe(true)
          expect(moved).toEqual([])

          expect(await count(b.organizationId)).toBe(before)
        })
      }
    }
  })

  describe('tenancy exceptions', () => {
    const claims = () => memberClaims(a.organizationId, a.userId, ALL_PERMISSIONS)

    it('shows a scope its own organization only, and never updates or locks another', async () => {
      const visible = await run(claims(), (tx) =>
        tx.select({ id: organizations.id }).from(organizations),
      )
      expect(visible).toEqual([{ id: a.organizationId }])
      const updated = await run(claims(), (tx) =>
        tx
          .update(organizations)
          .set({ name: 'Taken' })
          .where(eq(organizations.id, b.organizationId))
          .returning({ id: organizations.id }),
      )
      expect(updated).toEqual([])
      const locked = await run(claims(), (tx) =>
        tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, b.organizationId))
          .for('update'),
      )
      expect(locked).toEqual([])
    })

    it('shows team members of the teams of the organization only', async () => {
      const visible = await run(claims(), (tx) =>
        tx.select({ userId: teamMembers.userId }).from(teamMembers),
      )
      expect(visible).toEqual([{ userId: a.userId }])
    })

    it('shows the people of the organization only, and only their public columns', async () => {
      const visible = await run(claims(), (tx) =>
        tx
          .select({ id: users.id, name: users.name, email: users.email, image: users.image })
          .from(users),
      )
      expect(visible.map((user) => user.id)).toEqual([a.userId])
      expect(visible.map((user) => user.id)).not.toContain(outsider)
      const language = await failureOf(() =>
        run(claims(), (tx) => tx.select({ language: users.language }).from(users)),
      )
      expect(isInsufficientPrivilege(language)).toBe(true)
    })

    it('refuses every other better_auth table', async () => {
      for (const table of betterAuthTables.filter((t) => getTableName(t) !== 'users')) {
        const failure = await failureOf(() =>
          run(claims(), (tx) => rowsOf(tx, sql`select 1 from ${table}`)),
        )
        expect(isInsufficientPrivilege(failure), getTableName(table)).toBe(true)
      }
    })
  })

  describe('claims without an organization', () => {
    const tokenShaped = () => ({ sub: a.userId, role: 'authenticated' }) as unknown as Claims

    it('sees no row of any table authenticated may read', async () => {
      for (const table of [...publicTables, users]) {
        const visible = await run(tokenShaped(), (tx) =>
          rowsOf(tx, sql`select ${sql.raw(table === users ? 'id' : '1')} from ${table}`),
        )
        expect(visible, getTableName(table)).toEqual([])
      }
    })

    it('cannot insert', async () => {
      const failure = await failureOf(() =>
        run(tokenShaped(), (tx) => tx.insert(tasks).values(fixtures.tasks!.row(a) as never)),
      )
      expect(isInsufficientPrivilege(failure)).toBe(true)
    })
  })

  describe('permission gates', () => {
    let org: string
    let owner: string
    let colleague: string
    const as = (userId: string, permissions: string[] = []) =>
      memberClaims(org, userId, permissions)
    const system = () => systemClaims(org)
    const refused = async (claims: Claims, work: (tx: Database) => Promise<unknown>) =>
      expect(isInsufficientPrivilege(await failureOf(() => run(claims, work)))).toBe(true)

    beforeAll(async () => {
      org = (await insertOrganization(data, { slug: 'gates' })).id
      owner = await insertUser(data, 'owner@gates.test', 'Owner')
      colleague = await insertUser(data, 'colleague@gates.test', 'Colleague')
      await insertMember(data, org, owner, 'owner')
      await insertMember(data, org, colleague, 'member')
    })

    const newWorkspace = async () =>
      (
        await data.db
          .insert(workspaces)
          .values({ organizationId: org, name: `W ${randomUUID()}` })
          .returning()
      )[0]!
    const newFile = async (workspaceId: string | null = null) =>
      (
        await data.db
          .insert(files)
          .values({
            organizationId: org,
            workspaceId,
            name: `${randomUUID()}.pdf`,
            contentType: 'application/pdf',
            sizeBytes: 1,
            uploadedBy: owner,
          })
          .returning()
      )[0]!
    const newArtifact = async (workspaceId: string | null = null) =>
      (
        await data.db
          .insert(artifacts)
          .values({
            organizationId: org,
            workspaceId,
            title: 'A',
            format: 'markdown',
            createdBy: owner,
          })
          .returning()
      )[0]!

    it('gates workspace writes by their permissions', async () => {
      await refused(as(colleague), (tx) =>
        tx.insert(workspaces).values({ organizationId: org, name: 'Nope' }),
      )
      await run(as(colleague, ['workspace:create']), (tx) =>
        tx.insert(workspaces).values({ organizationId: org, name: 'Yes' }),
      )
      const workspace = await newWorkspace()
      const rename = (permissions: string[]) =>
        run(as(colleague, permissions), (tx) =>
          tx
            .update(workspaces)
            .set({ name: `R ${randomUUID()}` })
            .where(eq(workspaces.id, workspace.id))
            .returning({ id: workspaces.id }),
        )
      expect(await rename([])).toEqual([])
      expect(await rename(['workspace:update'])).toHaveLength(1)
      const remove = (permissions: string[]) =>
        run(as(colleague, permissions), (tx) =>
          tx
            .delete(workspaces)
            .where(eq(workspaces.id, workspace.id))
            .returning({ id: workspaces.id }),
        )
      expect(await remove([])).toEqual([])
      expect(await remove(['workspace:delete'])).toHaveLength(1)
    })

    it('lets uploaders manage their files, and others only with the permission', async () => {
      const row = {
        organizationId: org,
        name: 'up.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1,
      }
      await refused(as(colleague), (tx) =>
        tx.insert(files).values({ ...row, uploadedBy: colleague }),
      )
      await run(as(colleague, ['file:upload']), (tx) =>
        tx.insert(files).values({ ...row, uploadedBy: colleague }),
      )

      const file = await newFile()
      const rename = (userId: string, permissions: string[] = []) =>
        run(as(userId, permissions), (tx) =>
          tx
            .update(files)
            .set({ name: `${randomUUID()}.pdf` })
            .where(eq(files.id, file.id))
            .returning({ id: files.id }),
        )
      expect(await rename(owner)).toHaveLength(1)
      expect(await rename(colleague)).toEqual([])
      expect(await rename(colleague, ['file:update'])).toHaveLength(1)

      const lock = (permissions: string[]) =>
        run(as(colleague, permissions), (tx) =>
          tx.select({ id: files.id }).from(files).where(eq(files.id, file.id)).for('update'),
        )
      expect(await lock([])).toEqual([])
      expect(await lock(['file:update'])).toHaveLength(1)

      const remove = (userId: string, target: string, permissions: string[] = []) =>
        run(as(userId, permissions), (tx) =>
          tx.delete(files).where(eq(files.id, target)).returning({ id: files.id }),
        )
      expect(await remove(colleague, file.id)).toEqual([])
      expect(await remove(colleague, file.id, ['file:delete'])).toHaveLength(1)
      expect(await remove(owner, (await newFile()).id)).toHaveLength(1)
    })

    it('lets creators manage their artifacts, and others only with the permission', async () => {
      await refused(as(colleague), (tx) =>
        tx.insert(artifacts).values({ organizationId: org, title: 'N', format: 'markdown' }),
      )
      await run(as(colleague, ['artifact:create']), (tx) =>
        tx.insert(artifacts).values({ organizationId: org, title: 'Y', format: 'markdown' }),
      )

      const artifact = await newArtifact()
      const retitle = (userId: string, permissions: string[] = []) =>
        run(as(userId, permissions), (tx) =>
          tx
            .update(artifacts)
            .set({ title: randomUUID() })
            .where(eq(artifacts.id, artifact.id))
            .returning({ id: artifacts.id }),
        )
      expect(await retitle(owner)).toHaveLength(1)
      expect(await retitle(colleague)).toEqual([])
      expect(await retitle(colleague, ['artifact:update'])).toHaveLength(1)

      const version = (number: number) => ({
        organizationId: org,
        artifactId: artifact.id,
        number,
        content: 'x',
        sizeBytes: 1,
      })
      await run(as(owner), (tx) => tx.insert(artifactVersions).values(version(2)))
      await refused(as(colleague), (tx) => tx.insert(artifactVersions).values(version(3)))
      await run(as(colleague, ['artifact:update']), (tx) =>
        tx.insert(artifactVersions).values(version(3)),
      )

      const remove = (userId: string, target: string, permissions: string[] = []) =>
        run(as(userId, permissions), (tx) =>
          tx.delete(artifacts).where(eq(artifacts.id, target)).returning({ id: artifacts.id }),
        )
      expect(await remove(colleague, artifact.id)).toEqual([])
      expect(await remove(colleague, artifact.id, ['artifact:delete'])).toHaveLength(1)
      expect(await remove(owner, (await newArtifact()).id)).toHaveLength(1)
    })

    it('lets any member start a task and only the system move it', async () => {
      const [task] = await run(as(colleague), (tx) =>
        tx
          .insert(tasks)
          .values({ organizationId: org, kind: 'test', maxAttempts: 1, requestedBy: colleague })
          .returning({ id: tasks.id }),
      )
      const start = (claims: Claims) =>
        run(claims, (tx) =>
          tx
            .update(tasks)
            .set({ status: 'running' })
            .where(eq(tasks.id, task!.id))
            .returning({ id: tasks.id }),
        )
      expect(await start(as(colleague, ALL_PERMISSIONS))).toEqual([])
      expect(await start(system())).toHaveLength(1)
    })

    it('lets a member spend credits and only the system mint or adjust them', async () => {
      const entry = (reason: 'consumption' | 'purchase' | 'adjustment') => ({
        organizationId: org,
        metric: 'ai_credits',
        bucket: 'purchased' as const,
        reason,
        amount: reason === 'consumption' ? -1 : 10,
        idempotencyKey: randomUUID(),
      })
      await run(as(colleague), (tx) => tx.insert(creditLedger).values(entry('consumption')))
      await refused(as(colleague, ALL_PERMISSIONS), (tx) =>
        tx.insert(creditLedger).values(entry('purchase')),
      )
      await refused(as(colleague, ALL_PERMISSIONS), (tx) =>
        tx.insert(creditLedger).values(entry('adjustment')),
      )
      await run(system(), (tx) => tx.insert(creditLedger).values(entry('purchase')))
      await run(system(), (tx) => tx.insert(creditLedger).values(entry('adjustment')))
    })

    it('lets a member upsert usage levels', async () => {
      const upsert = (value: number) =>
        run(as(colleague), (tx) =>
          tx
            .insert(usageLevels)
            .values({ organizationId: org, metric: 'storage_gb', value })
            .onConflictDoUpdate({
              target: [usageLevels.organizationId, usageLevels.metric],
              set: { value },
            }),
        )
      await upsert(1)
      await upsert(2)
      const [level] = await data.db
        .select({ value: usageLevels.value })
        .from(usageLevels)
        .where(and(eq(usageLevels.organizationId, org), eq(usageLevels.metric, 'storage_gb')))
      expect(level).toEqual({ value: 2 })
    })

    it('lets any member lock the organization row, and only billing managers change it', async () => {
      const locked = await run(as(colleague), (tx) =>
        tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, org))
          .for('no key update'),
      )
      expect(locked).toEqual([{ id: org }])
      const rename = (tx: Database) =>
        tx
          .update(organizations)
          .set({ name: 'Renamed' })
          .where(eq(organizations.id, org))
          .returning({ id: organizations.id })
      await refused(as(colleague), rename)
      expect(await run(as(colleague, ['billing:manage']), rename)).toHaveLength(1)
    })

    it('lets only the system update invitations', async () => {
      const [invitation] = await data.db
        .insert(invitations)
        .values({
          organizationId: org,
          email: 'guest@gates.test',
          inviterId: owner,
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning()
      const markSent = (claims: Claims) =>
        run(claims, (tx) =>
          tx
            .update(invitations)
            .set({ emailSent: true })
            .where(eq(invitations.id, invitation!.id))
            .returning({ id: invitations.id }),
        )
      expect(await markSent(as(owner, ALL_PERMISSIONS))).toEqual([])
      expect(await markSent(system())).toHaveLength(1)
    })

    it('accepts no write on the tables Better Auth owns, even from the system', async () => {
      const tenant: Tenant = { organizationId: org, userId: owner, workspaceId: '', artifactId: '' }
      for (const name of ['members', 'teams', 'organization_roles']) {
        const { table, row } = fixtures[name]!
        await refused(system(), (tx) => tx.insert(table).values(row(tenant) as never))
        expect(
          await run(system(), (tx) =>
            rowsOf(tx, sql`update ${table} set organization_id = organization_id returning 1`),
          ),
        ).toEqual([])
        expect(
          await run(system(), (tx) => rowsOf(tx, sql`delete from ${table} returning 1`)),
        ).toEqual([])
      }
      const [team] = await data.db
        .insert(teams)
        .values({ organizationId: org, name: 'T' })
        .returning()
      await data.db.insert(teamMembers).values({ teamId: team!.id, userId: owner })
      await refused(system(), (tx) =>
        tx.insert(teamMembers).values({ teamId: team!.id, userId: colleague }),
      )
      expect(
        await run(system(), (tx) =>
          rowsOf(tx, sql`update ${teamMembers} set user_id = user_id returning 1`),
        ),
      ).toEqual([])
      expect(
        await run(system(), (tx) => rowsOf(tx, sql`delete from ${teamMembers} returning 1`)),
      ).toEqual([])
    })

    it('cascades a workspace delete to files and artifacts the caller could not delete', async () => {
      const workspace = await newWorkspace()
      await newFile(workspace.id)
      await newArtifact(workspace.id)
      const removed = await run(as(colleague, ['workspace:delete']), (tx) =>
        tx
          .delete(workspaces)
          .where(eq(workspaces.id, workspace.id))
          .returning({ id: workspaces.id }),
      )
      expect(removed).toHaveLength(1)
      const left = await raw(
        `select (select count(*)::int from files where workspace_id = $1) as files,
                (select count(*)::int from artifacts where workspace_id = $1) as artifacts`,
        [workspace.id],
      )
      expect(left.rows).toEqual([{ files: 0, artifacts: 0 }])
    })

    it('refuses truncate', async () => {
      await refused(system(), (tx) => rowsOf(tx, sql`truncate ${workspaces}`))
    })
  })
})
