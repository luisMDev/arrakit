import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DomainError } from '../errors'
import { users } from '../schema/index'
import { type TestData, insertOrganization, insertUser, openTestData } from '../testing'

describe('organization workspaces', () => {
  let data: TestData

  beforeAll(async () => {
    data = await openTestData()
  })
  afterAll(() => data.close())

  const organizationOf = async (tag: string) => {
    const owner = await insertUser(data, `owner@${tag}.vc`, `Owner ${tag}`)
    const organization = await insertOrganization(data, { slug: tag })
    return { owner, workspaces: data.forOrganization(organization.id).workspaces }
  }

  it('creates workspaces and lists them by name, ignoring case', async () => {
    const f = await organizationOf('alder')
    const created = await f.workspaces.create({
      name: 'marketing',
      description: 'Campaigns',
      createdBy: f.owner,
    })
    await f.workspaces.create({ name: 'Finance', description: '', createdBy: f.owner })

    expect(created).toMatchObject({
      name: 'marketing',
      description: 'Campaigns',
      createdBy: f.owner,
    })
    expect((await f.workspaces.list()).map((w) => w.name)).toEqual(['Finance', 'marketing'])
    expect((await f.workspaces.list())[1]).toEqual(created)
  })

  it('refuses a name the organization already has, ignoring case, but not another’s', async () => {
    const f = await organizationOf('birch')
    const other = await organizationOf('cedar')
    await f.workspaces.create({ name: 'Ops', description: '', createdBy: f.owner })
    const sales = await f.workspaces.create({ name: 'Sales', description: '', createdBy: f.owner })

    const duplicate = f.workspaces.create({ name: 'OPS', description: '', createdBy: f.owner })
    await expect(duplicate).rejects.toBeInstanceOf(DomainError)
    await expect(duplicate).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      f.workspaces.update(sales.id, { name: 'ops', description: '' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      other.workspaces.create({ name: 'Ops', description: '', createdBy: other.owner }),
    ).resolves.toMatchObject({ name: 'Ops' })
  })

  it('updates and removes only its own workspaces', async () => {
    const f = await organizationOf('elm')
    const other = await organizationOf('fir')
    const mine = await f.workspaces.create({ name: 'Legal', description: '', createdBy: f.owner })

    expect(await other.workspaces.list()).toEqual([])
    expect(
      await other.workspaces.update(mine.id, { name: 'Taken', description: '' }),
    ).toBeUndefined()
    expect(await other.workspaces.remove(mine.id)).toBe(false)
    expect(await f.workspaces.list()).toMatchObject([{ name: 'Legal' }])

    const renamed = await f.workspaces.update(mine.id, {
      name: 'Legal & Risk',
      description: 'Contracts',
    })
    expect(renamed).toMatchObject({ name: 'Legal & Risk', description: 'Contracts' })
    expect(renamed!.updatedAt.getTime()).toBeGreaterThanOrEqual(mine.updatedAt.getTime())

    expect(await f.workspaces.remove(mine.id)).toBe(true)
    expect(await f.workspaces.list()).toEqual([])
    expect(
      await f.workspaces.update(randomUUID(), { name: 'Ghost', description: '' }),
    ).toBeUndefined()
  })

  it('keeps a workspace when the person who created it is deleted', async () => {
    const f = await organizationOf('gum')
    const ana = await insertUser(data, 'ana@gum.vc', 'Ana')
    const made = await f.workspaces.create({ name: 'Design', description: '', createdBy: ana })

    await data.db.delete(users).where(eq(users.id, ana))

    expect(await f.workspaces.list()).toMatchObject([{ id: made.id, createdBy: null }])
  })
})
