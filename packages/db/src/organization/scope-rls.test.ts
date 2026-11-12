import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { consoleLog, type DataContext } from '../context'
import { isInsufficientPrivilege } from '../errors'
import { members } from '../schema/index'
import {
  type TestData,
  insertMember,
  insertOrganization,
  insertUser,
  memberClaims,
  openTestData,
  systemClaims,
} from '../testing'
import { forOrganization } from './index'

const pdf = (name: string) => ({ name, contentType: 'application/pdf', sizeBytes: 10 })
const report = (title: string) => ({ title, format: 'markdown' as const, content: '# Hi' })

const EVERY_PERMISSION = [
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

const refusal = (work: Promise<unknown>) => work.then(() => undefined).catch((err: unknown) => err)

describe('organization scopes under RLS', () => {
  let data: TestData
  let ctx: DataContext

  beforeAll(async () => {
    data = await openTestData()
    ctx = {
      db: data.db,
      jobs: data.jobs,
      storage: data.storage,
      now: () => new Date(),
      log: consoleLog,
    }
  })
  afterAll(() => data.close())

  async function organizationOf(tag: string) {
    const organization = await insertOrganization(data, { slug: `${tag}-${randomUUID()}` })
    const person = async (name: string) => {
      const id = await insertUser(data, `${name.toLowerCase()}@${tag}.vc`, name)
      await insertMember(data, organization.id, id, 'member')
      return id
    }
    const ana = await person('Ana')
    const ben = await person('Ben')
    const as = (userId: string, permissions: readonly string[] = []) =>
      forOrganization(ctx, memberClaims(organization.id, userId, permissions))
    const system = forOrganization(ctx, systemClaims(organization.id))
    return { id: organization.id, ana, ben, person, as, system }
  }

  it('refuses a workspace to a member without workspace:create', async () => {
    const org = await organizationOf('ash')
    const input = { name: 'Deals', description: '', createdBy: org.ana }

    expect(isInsufficientPrivilege(await refusal(org.as(org.ana).workspaces.create(input)))).toBe(
      true,
    )
    const created = await org.as(org.ana, ['workspace:create']).workspaces.create(input)
    expect(created).toMatchObject({ organizationId: org.id, name: 'Deals' })
  })

  it('lets the uploader rename a file, and others only with file:update', async () => {
    const org = await organizationOf('beech')
    const files = org.as(org.ana, ['file:upload']).files
    const file = await files.reserve({ ...pdf('a.pdf'), workspaceId: null, uploadedBy: org.ana })
    await files.complete(file.id)

    expect(await org.as(org.ben).files.rename(file.id, 'b.pdf')).toBeUndefined()
    expect(await org.as(org.ana).files.rename(file.id, 'b.pdf')).toMatchObject({ name: 'b.pdf' })
    expect(await org.as(org.ben, ['file:update']).files.rename(file.id, 'c.pdf')).toMatchObject({
      name: 'c.pdf',
    })
  })

  it('lets only the system move a task', async () => {
    const org = await organizationOf('cedar')
    const task = await org.as(org.ana).tasks.start({
      queue: 'export',
      kind: 'workspace.export',
      workspaceId: null,
      requestedBy: org.ana,
      maxAttempts: 1,
      input: {},
    })

    expect(await org.as(org.ana, EVERY_PERMISSION).tasks.begin(task.id, 0)).toBeUndefined()
    expect(await org.system.tasks.begin(task.id, 0)).toMatchObject({ status: 'running' })
  })

  it('lets a member spend credits, and only the system add them', async () => {
    const org = await organizationOf('dogwood')
    const usage = org.as(org.ana).usage

    expect(await usage.consume('credits', 5, { idempotencyKey: 'use-1' })).toMatchObject({
      used: 5,
    })
    expect(
      isInsufficientPrivilege(
        await refusal(org.as(org.ana, EVERY_PERMISSION).usage.credit(500, { idempotencyKey: 'c' })),
      ),
    ).toBe(true)
    expect(await org.system.usage.credit(500, { idempotencyKey: 'c' })).toBe(true)
  })

  it('changes the plan only with billing:manage', async () => {
    const org = await organizationOf('elm')

    expect(isInsufficientPrivilege(await refusal(org.as(org.ana).setPlan('pro')))).toBe(true)
    expect(await org.as(org.ana, ['billing:manage']).setPlan('pro')).toMatchObject({ plan: 'pro' })
  })

  it('shows no name for an uploader who is no longer a member', async () => {
    const org = await organizationOf('fir')
    const cleo = await org.person('Cleo')
    const files = org.system.files
    const file = await files.reserve({ ...pdf('a.pdf'), workspaceId: null, uploadedBy: cleo })
    await files.complete(file.id)
    expect((await org.as(org.ana).files.list(null))[0]).toMatchObject({ uploaderName: 'Cleo' })

    await data.db
      .delete(members)
      .where(and(eq(members.organizationId, org.id), eq(members.userId, cleo)))

    expect(await org.as(org.ana).files.list(null)).toMatchObject([
      { id: file.id, uploadedBy: cleo, uploaderName: null },
    ])
  })

  it('reaches nothing of another organization through its ids', async () => {
    const mine = await organizationOf('ginkgo')
    const theirs = await organizationOf('hazel')
    const workspace = await theirs.system.workspaces.create({
      name: 'Theirs',
      description: '',
      createdBy: theirs.ana,
    })
    const file = await theirs.system.files.reserve({
      ...pdf('a.pdf'),
      workspaceId: workspace.id,
      uploadedBy: theirs.ana,
    })
    await theirs.system.files.complete(file.id)
    const { artifact } = await theirs.system.artifacts.create({
      ...report('Plan'),
      workspaceId: workspace.id,
      createdBy: theirs.ana,
    })
    const task = await theirs.system.tasks.start({
      queue: 'export',
      kind: 'workspace.export',
      workspaceId: workspace.id,
      requestedBy: theirs.ana,
      maxAttempts: 1,
      input: {},
    })

    for (const scope of [mine.as(mine.ana, EVERY_PERMISSION), mine.system]) {
      expect(await scope.workspaces.get(workspace.id)).toBeUndefined()
      expect(
        await scope.workspaces.update(workspace.id, { name: 'Mine', description: '' }),
      ).toBeUndefined()
      expect(await scope.files.get(file.id)).toBeUndefined()
      expect(await scope.files.list(workspace.id)).toEqual([])
      expect(await scope.files.rename(file.id, 'mine.pdf')).toBeUndefined()
      expect(await scope.files.remove(file.id)).toBeUndefined()
      expect(await scope.artifacts.get(artifact.id)).toBeUndefined()
      expect(await scope.artifacts.list(workspace.id)).toEqual([])
      expect(await scope.artifacts.versions(artifact.id)).toEqual([])
      expect(await scope.artifacts.rename(artifact.id, 'Mine')).toBeUndefined()
      expect(await scope.artifacts.remove(artifact.id)).toBeUndefined()
      expect(await scope.tasks.get(task.id)).toBeUndefined()
      expect(await scope.workspaces.remove(workspace.id)).toBe(false)
    }

    expect(await theirs.system.workspaces.get(workspace.id)).toMatchObject({ name: 'Theirs' })
    expect(await theirs.system.files.get(file.id)).toMatchObject({ name: 'a.pdf' })
    expect(await theirs.system.artifacts.get(artifact.id)).toMatchObject({ title: 'Plan' })
  })
})
