import { randomUUID } from 'node:crypto'

import { inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { isInsufficientPrivilege } from '../errors'
import { type Data, openData } from '../open-data'
import { organizations, users } from '../schema/index'
import { memoryStorage } from '../storage/memory'
import { insertOrganization, insertUser, memberClaims, stackEnv } from '../testing'

const silent = { info: () => undefined, error: () => undefined }

describe('organization scopes through the pooler', () => {
  let data: Data
  const organizationIds: string[] = []
  const userIds: string[] = []

  const newOrganization = async () => {
    const { id } = await insertOrganization(data, { slug: `stack-${randomUUID()}` })
    organizationIds.push(id)
    return id
  }
  const newUser = async () => {
    const id = await insertUser(data, `stack-${randomUUID()}@example.test`)
    userIds.push(id)
    return id
  }

  beforeAll(async () => {
    data = await openData(
      { databaseUrl: stackEnv().DATABASE_URL },
      { storage: memoryStorage(), log: silent },
    )
  })
  afterAll(async () => {
    if (organizationIds.length > 0)
      await data.db.delete(organizations).where(inArray(organizations.id, organizationIds))
    if (userIds.length > 0) await data.db.delete(users).where(inArray(users.id, userIds))
    await data?.close()
  })

  it('shows a member the rows of their organization only and applies the write gates', async () => {
    const [a, b] = [await newOrganization(), await newOrganization()]
    const [member, outsider, bystander] = [await newUser(), await newUser(), await newUser()]

    const inA = data.forOrganization(memberClaims(a, member, ['workspace:create']))
    const created = await inA.workspaces.create({
      name: 'Deals',
      description: '',
      createdBy: member,
    })
    expect((await inA.workspaces.list()).map((row) => row.id)).toEqual([created.id])

    const inB = data.forOrganization(
      memberClaims(b, outsider, ['workspace:create', 'workspace:update', 'workspace:delete']),
    )
    expect(await inB.workspaces.list()).toEqual([])
    expect(await inB.workspaces.get(created.id)).toBeUndefined()
    expect(
      await inB.workspaces.update(created.id, { name: 'Taken', description: '' }),
    ).toBeUndefined()

    const unprivileged = data.forOrganization(memberClaims(a, bystander))
    const refusal = await unprivileged.workspaces
      .create({ name: 'Other', description: '', createdBy: bystander })
      .then(
        () => undefined,
        (err: unknown) => err,
      )
    expect(isInsufficientPrivilege(refusal)).toBe(true)
    expect((await inA.workspaces.get(created.id))?.name).toBe('Deals')
  })

  it('leaves no role or claims behind on pooled connections', async () => {
    const a = await newOrganization()
    for (let round = 0; round < 3; round++) await data.asSystem(a).workspaces.list()
    await Promise.all(Array.from({ length: 10 }, () => data.asSystem(a).workspaces.list()))

    const sessions = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const result = (await data.db.execute(
          sql`select current_setting('role') as role, coalesce(current_setting('request.jwt.claims', true), '') as claims`,
        )) as unknown as { rows: { role: string; claims: string }[] }
        return result.rows[0]
      }),
    )
    expect(sessions).toEqual(Array.from({ length: 20 }, () => ({ role: 'none', claims: '' })))
  })

  it('works a job queued from an organization operation once it commits', async () => {
    const a = await newOrganization()
    const queue = `stack_${randomUUID().replaceAll('-', '')}`
    await data.jobs.defineQueue(queue, { retryLimit: 0, retryDelay: 0, retryBackoff: false })
    const seen: unknown[] = []
    await data.jobs.work(queue, async (payload) => {
      seen.push(payload)
    })

    const task = await data.asSystem(a).tasks.start({
      queue,
      kind: 'stack.check',
      workspaceId: null,
      requestedBy: null,
      maxAttempts: 1,
      input: { n: 1 },
    })

    await vi.waitFor(
      () => expect(seen).toEqual([{ taskId: task.id, organizationId: a, input: { n: 1 } }]),
      { timeout: 20_000, interval: 200 },
    )
  })
})
