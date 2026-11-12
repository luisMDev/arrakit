import {
  type Permissions,
  allows,
  claimsFor,
  customRoleMap,
  permissionClaims,
  permissionsOf,
  statements,
} from '@arrakit/auth/permissions'
import type { OrganizationScope } from '@arrakit/db'
import { call, os } from '@orpc/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { type TestApp, createTestApp } from '../testing/app'
import { joinAs, orgApi, ownerOf, sqlOf } from '../testing/people'
import { type BaseContext, requireMember, requireSession } from './context'

const INSUFFICIENT_PRIVILEGE = '42501'
const VIEWER = { workspace: ['read'] }

/** True when the error, or one it wraps, is Postgres refusing the statement (an RLS check). */
function refusedByDatabase(err: unknown): boolean {
  for (let at = err; at instanceof Error || (at && typeof at === 'object');) {
    if ((at as { code?: unknown }).code === INSUFFICIENT_PRIVILEGE) return true
    at = (at as { cause?: unknown }).cause
  }
  return false
}

/** `work`'s outcome: 'allowed', or 'refused' when the database refuses it; anything else throws. */
async function outcomeOf(work: () => Promise<unknown>): Promise<'allowed' | 'refused'> {
  try {
    await work()
    return 'allowed'
  } catch (err) {
    if (refusedByDatabase(err)) return 'refused'
    throw err
  }
}

const createsWorkspace = os
  .$context<BaseContext>()
  .use(requireSession)
  .use(requireMember())
  .input(z.object({ name: z.string() }))
  .handler(({ context, input }) =>
    context.scope.workspaces.create({
      name: input.name,
      description: '',
      createdBy: context.user.id,
    }),
  )

describe('claims from the permission matrix', () => {
  let t: TestApp
  let owner: Awaited<ReturnType<typeof ownerOf>>
  let other: Awaited<ReturnType<typeof ownerOf>>
  let counter = 0
  const unique = (name: string) => `${name} ${++counter}`

  const scopeOf = (userId: string, organizationId: string, permissions: Permissions) =>
    t.data.forOrganization(claimsFor({ userId, organizationId, permissions }))

  beforeAll(async () => {
    t = await createTestApp()
    owner = await ownerOf(t, 'owner@claims.vc')
    other = await ownerOf(t, 'owner@elsewhere.vc')
    const created = await orgApi(t, owner.headers).post('create-role', {
      role: 'viewer',
      permission: VIEWER,
      organizationId: owner.organizationId,
    })
    if (created.status !== 200) throw new Error(`create-role refused: ${JSON.stringify(created)}`)
  })
  afterAll(() => t.close())

  it('names in its policies only permissions the access-control statements define', async () => {
    const { rows } = await sqlOf(t)(
      `select coalesce(qual, '') || ' ' || coalesce(with_check, '') as expression from pg_policies`,
    )
    const named = new Set(
      rows.flatMap(({ expression }) =>
        [...String(expression).matchAll(/has_permission\('([^']+)'/g)].map((match) => match[1]!),
      ),
    )
    expect(named.size).toBeGreaterThan(0)
    expect(
      [...named].filter((permission) => !permissionClaims(statements).includes(permission)),
    ).toEqual([])
  })

  describe.each([
    ['owner', 'owner'],
    ['admin', 'admin'],
    ['member', 'member'],
    ['a custom role with workspace:read only', 'viewer'],
  ])('a scope with the claims of %s', (_, role) => {
    let scope: OrganizationScope
    let permissions: Permissions

    beforeAll(async () => {
      const person = await joinAs(t, owner.organizationId, `${role}.person@claims.vc`, role)
      const custom = customRoleMap(await t.data.customRoles(owner.organizationId))
      permissions = permissionsOf(role, custom)
      scope = scopeOf(person.userId, owner.organizationId, permissions)
    })

    it('creates a workspace exactly when the role grants workspace:create', async () => {
      const outcome = await outcomeOf(() =>
        scope.workspaces.create({ name: unique(role), description: '', createdBy: owner.userId }),
      )
      expect(outcome).toBe(allows(permissions, { workspace: ['create'] }) ? 'allowed' : 'refused')
    })

    it('reserves a file exactly when the role grants file:upload', async () => {
      const outcome = await outcomeOf(() =>
        scope.files.reserve({
          workspaceId: null,
          name: `${unique(role)}.pdf`,
          contentType: 'application/pdf',
          sizeBytes: 10,
          uploadedBy: owner.userId,
        }),
      )
      expect(outcome).toBe(allows(permissions, { file: ['upload'] }) ? 'allowed' : 'refused')
    })

    it('sets the plan exactly when the role grants billing:manage', async () => {
      const outcome = await outcomeOf(() => scope.setPlan('team'))
      expect(outcome).toBe(allows(permissions, { billing: ['manage'] }) ? 'allowed' : 'refused')
    })
  })

  it("hands requireMember's caller a scope the database confines to their role", async () => {
    const viewer = await joinAs(t, owner.organizationId, 'viewer@request.vc', 'viewer')
    const name = unique('requested')

    await expect(
      call(createsWorkspace, { name }, { context: t.context(viewer.headers) }),
    ).rejects.toSatisfy(refusedByDatabase)
    expect(
      await call(createsWorkspace, { name }, { context: t.context(owner.headers) }),
    ).toMatchObject({ name, organizationId: owner.organizationId })
  })

  it("cannot read or change another organization's rows, whatever ids it is given", async () => {
    const theirs = await t.data.asSystem(other.organizationId).workspaces.create({
      name: unique('theirs'),
      description: '',
      createdBy: other.userId,
    })
    const theirFile = await t.data.asSystem(other.organizationId).files.reserve({
      workspaceId: null,
      name: `${unique('theirs')}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 10,
      uploadedBy: other.userId,
    })
    const mine = scopeOf(owner.userId, owner.organizationId, permissionsOf('owner'))

    expect(await mine.workspaces.get(theirs.id)).toBeUndefined()
    expect((await mine.workspaces.list()).map((row) => row.id)).not.toContain(theirs.id)
    expect(
      await mine.workspaces.update(theirs.id, { name: 'taken', description: '' }),
    ).toBeUndefined()
    expect(await mine.workspaces.remove(theirs.id)).toBe(false)
    expect(await mine.files.get(theirFile.id)).toBeUndefined()
    expect(await mine.files.rename(theirFile.id, 'taken.pdf')).toBeUndefined()
    expect(await mine.files.remove(theirFile.id)).toBeUndefined()

    const intact = t.data.asSystem(other.organizationId)
    expect(await intact.workspaces.get(theirs.id)).toMatchObject({ name: theirs.name })
    expect(await intact.files.get(theirFile.id)).toMatchObject({ name: theirFile.name })
  })
})
