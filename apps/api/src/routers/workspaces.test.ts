import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type TestApp, createTestApp } from '../testing/app'
import { joinAs, orgApi, ownerOf } from '../testing/people'

describe('workspaces', () => {
  let t: TestApp
  let counter = 0

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  const organization = async () => {
    counter += 1
    const owner = await ownerOf(t, `owner${counter}@acme.com`, 'free')
    const member = await joinAs(t, owner.organizationId, `member${counter}@acme.com`, 'member')
    return { owner, member }
  }

  it('lets the owner create, rename and delete a workspace, trimming what was typed', async () => {
    const { owner } = await organization()
    const api = t.client(owner.headers).workspaces

    const created = await api.create({ name: '  Marketing ', description: ' Campaigns ' })
    expect(created).toEqual({
      id: expect.any(String),
      name: 'Marketing',
      description: 'Campaigns',
      createdOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
    const [stored] = await t.data.asSystem(owner.organizationId).workspaces.list()
    expect(stored?.createdBy).toBe(owner.userId)

    await expect(
      api.update({ id: created.id, name: 'Growth', description: '' }),
    ).resolves.toMatchObject({ id: created.id, name: 'Growth', description: '' })
    await expect(api.list()).resolves.toMatchObject([{ name: 'Growth' }])

    await api.delete({ id: created.id })
    await expect(api.list()).resolves.toEqual([])
  })

  it('shows every member the organization’s workspaces by name, and only theirs', async () => {
    const { owner, member } = await organization()
    const other = await organization()
    await t.client(owner.headers).workspaces.create({ name: 'sales', description: '' })
    await t.client(member.headers).workspaces.create({ name: 'Design', description: '' })
    await t.client(other.owner.headers).workspaces.create({ name: 'Elsewhere', description: '' })

    const names = (await t.client(member.headers).workspaces.list()).map((w) => w.name)
    expect(names).toEqual(['Design', 'sales'])
  })

  it('answers 409 with the name for one the organization has, ignoring case', async () => {
    const { owner } = await organization()
    const api = t.client(owner.headers).workspaces
    await api.create({ name: 'Ops', description: '' })
    const finance = await api.create({ name: 'Finance', description: '' })

    await expect(api.create({ name: 'OPS', description: '' })).rejects.toMatchObject({
      status: 409,
      message: 'A workspace named OPS already exists.',
    })
    await expect(
      api.update({ id: finance.id, name: 'ops', description: '' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('refuses a blank or too long name and an id that is not a UUID', async () => {
    const { owner } = await organization()
    const api = t.client(owner.headers).workspaces
    await expect(api.create({ name: '   ', description: '' })).rejects.toMatchObject({
      status: 400,
    })
    await expect(api.create({ name: 'x'.repeat(101), description: '' })).rejects.toMatchObject({
      status: 400,
    })
    await expect(api.delete({ id: 'not-a-uuid' })).rejects.toMatchObject({ status: 400 })
  })

  it('answers 404 for a workspace of another organization, leaving it as it was', async () => {
    const { owner } = await organization()
    const other = await organization()
    const theirs = await t.client(other.owner.headers).workspaces.create({
      name: 'Private',
      description: '',
    })
    const api = t.client(owner.headers).workspaces

    await expect(
      api.update({ id: theirs.id, name: 'Mine now', description: '' }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(api.delete({ id: theirs.id })).rejects.toMatchObject({ status: 404 })
    await expect(api.delete({ id: randomUUID() })).rejects.toMatchObject({ status: 404 })
    await expect(t.client(other.owner.headers).workspaces.list()).resolves.toMatchObject([
      { name: 'Private' },
    ])
  })

  it('lets a member create but not rename or delete', async () => {
    const { owner, member } = await organization()
    const made = await t.client(owner.headers).workspaces.create({ name: 'Legal', description: '' })
    const api = t.client(member.headers).workspaces

    await expect(api.create({ name: 'Research', description: '' })).resolves.toMatchObject({
      name: 'Research',
    })
    await expect(api.update({ id: made.id, name: 'Law', description: '' })).rejects.toMatchObject({
      status: 403,
    })
    await expect(api.delete({ id: made.id })).rejects.toMatchObject({ status: 403 })
  })

  it('follows a custom role: without workspace read, nothing is listed', async () => {
    const { owner } = await organization()
    await orgApi(t, owner.headers).post('create-role', {
      role: 'auditor',
      permission: { usage: ['read'] },
      organizationId: owner.organizationId,
    })
    const auditor = await joinAs(t, owner.organizationId, `auditor${counter}@acme.com`, 'auditor')

    await expect(t.client(auditor.headers).workspaces.list()).rejects.toMatchObject({
      status: 403,
    })
  })

  it('answers 401 without a session', async () => {
    await expect(t.client().workspaces.list()).rejects.toMatchObject({ status: 401 })
  })
})
