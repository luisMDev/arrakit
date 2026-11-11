import { randomUUID } from 'node:crypto'

import { artifactPolicyFor } from '@arrakit/plans'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NO_SUCH_VERSION } from '../artifacts/artifacts'
import { type TestApp, createTestApp } from '../testing/app'
import { joinAs, orgApi, ownerOf } from '../testing/people'

describe('artifacts', () => {
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

  const report = (title = 'Pipeline', content = '<h1>Q3</h1>') => ({
    title,
    format: 'html' as const,
    content,
  })

  it('creates an artifact, lists it and reads its content', async () => {
    const { owner } = await organization()
    const api = t.client(owner.headers).artifacts

    const artifact = await api.create(report('  Pipeline  '))
    expect(artifact).toEqual({
      id: expect.any(String),
      workspaceId: null,
      title: 'Pipeline',
      format: 'html',
      currentVersion: 1,
      createdById: owner.userId,
      creatorName: expect.any(String),
      createdByYou: true,
      createdOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      updatedAt: expect.any(String),
    })
    await expect(api.list({})).resolves.toEqual([artifact])
    await expect(api.get({ id: artifact.id })).resolves.toEqual(artifact)
    await expect(api.content({ id: artifact.id })).resolves.toEqual({
      artifactId: artifact.id,
      version: 1,
      format: 'html',
      content: '<h1>Q3</h1>',
    })
    expect(t.data.jobs.published.at(-1)).toMatchObject({
      event: 'artifact.created',
      data: { artifactId: artifact.id, organizationId: owner.organizationId, version: 1 },
    })
  })

  it('publishes new versions under the same id and reads any of them', async () => {
    const { owner } = await organization()
    const api = t.client(owner.headers).artifacts
    const artifact = await api.create({ title: 'Notes', format: 'markdown', content: '# one' })

    const updated = await api.publish({ id: artifact.id, content: '# two' })
    expect(updated).toMatchObject({ id: artifact.id, currentVersion: 2, format: 'markdown' })
    await expect(api.content({ id: artifact.id })).resolves.toMatchObject({
      version: 2,
      content: '# two',
    })
    await expect(api.content({ id: artifact.id, version: 1 })).resolves.toMatchObject({
      version: 1,
      content: '# one',
    })
    await expect(api.content({ id: artifact.id, version: 3 })).rejects.toMatchObject({
      status: 404,
      message: NO_SUCH_VERSION,
    })
    const versions = await api.versions({ id: artifact.id })
    expect(versions.map((v) => v.number)).toEqual([2, 1])
    expect(versions[0]).toEqual({
      number: 2,
      sizeBytes: 5,
      publishedById: owner.userId,
      publisherName: expect.any(String),
      publishedAt: expect.any(String),
    })
    expect(t.data.jobs.published.at(-1)).toMatchObject({
      event: 'artifact.version_published',
      data: { artifactId: artifact.id, version: 2, sizeBytes: 5 },
    })
  })

  it('refuses content larger than the plan allows, with a 400', async () => {
    const { owner } = await organization()
    const api = t.client(owner.headers).artifacts
    const tooBig = 'x'.repeat(artifactPolicyFor('free').maxBytes + 1)

    await expect(api.create(report('Huge', tooBig))).rejects.toMatchObject({
      status: 400,
      message: 'The content is larger than the 2 MB limit.',
    })
    const artifact = await api.create(report())
    await expect(api.publish({ id: artifact.id, content: tooBig })).rejects.toMatchObject({
      status: 400,
    })
    await expect(api.create(report('   '))).rejects.toMatchObject({ status: 400 })
  })

  it('renames and deletes, publishing each change', async () => {
    const { owner } = await organization()
    const api = t.client(owner.headers).artifacts
    const artifact = await api.create(report('Draft'))

    await expect(api.rename({ id: artifact.id, title: 'Final' })).resolves.toMatchObject({
      title: 'Final',
    })
    expect(t.data.jobs.published.at(-1)).toMatchObject({
      event: 'artifact.renamed',
      data: { title: 'Final', previousTitle: 'Draft' },
    })
    await api.delete({ id: artifact.id })
    expect(t.data.jobs.published.at(-1)).toMatchObject({
      event: 'artifact.deleted',
      data: { artifactId: artifact.id },
    })
    await expect(api.list({})).resolves.toEqual([])
    await expect(api.delete({ id: artifact.id })).rejects.toMatchObject({ status: 404 })
  })

  it('keeps workspace artifacts apart from the organization’s, and refuses another’s workspace', async () => {
    const { owner } = await organization()
    const other = await organization()
    const workspace = await t
      .client(owner.headers)
      .workspaces.create({ name: 'Deals', description: '' })
    const theirs = await t
      .client(other.owner.headers)
      .workspaces.create({ name: 'X', description: '' })
    const api = t.client(owner.headers).artifacts
    await api.create({ ...report('Deal memo'), workspaceId: workspace.id })
    await api.create(report('Org report'))

    expect((await api.list({ workspaceId: workspace.id })).map((a) => a.title)).toEqual([
      'Deal memo',
    ])
    expect((await api.list({})).map((a) => a.title)).toEqual(['Org report'])
    await expect(api.list({ workspaceId: theirs.id })).rejects.toMatchObject({ status: 404 })
    await expect(api.create({ ...report('Sneaky'), workspaceId: theirs.id })).rejects.toMatchObject(
      { status: 404 },
    )
  })

  it('deleting a workspace deletes its artifacts', async () => {
    const { owner } = await organization()
    const workspace = await t
      .client(owner.headers)
      .workspaces.create({ name: 'Deals', description: '' })
    const artifact = await t
      .client(owner.headers)
      .artifacts.create({ ...report(), workspaceId: workspace.id })

    await t.client(owner.headers).workspaces.delete({ id: workspace.id })
    await expect(t.client(owner.headers).artifacts.get({ id: artifact.id })).rejects.toMatchObject({
      status: 404,
    })
    expect(t.data.jobs.published.map((e) => e.event)).toContain('artifact.deleted')
  })

  it('lets a member create and change their own artifacts, not another person’s', async () => {
    const { owner, member } = await organization()
    const ownersArtifact = await t.client(owner.headers).artifacts.create(report('Board'))
    const api = t.client(member.headers).artifacts
    const membersArtifact = await api.create(report('Mine'))

    expect((await api.list({})).map((a) => [a.title, a.createdByYou])).toEqual([
      ['Mine', true],
      ['Board', false],
    ])
    await expect(api.content({ id: ownersArtifact.id })).resolves.toMatchObject({ version: 1 })
    for (const call of [
      () => api.publish({ id: ownersArtifact.id, content: 'x' }),
      () => api.rename({ id: ownersArtifact.id, title: 'Ours' }),
      () => api.delete({ id: ownersArtifact.id }),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 403 })
    }
    await expect(api.publish({ id: membersArtifact.id, content: 'v2' })).resolves.toMatchObject({
      currentVersion: 2,
    })
    await expect(
      api.rename({ id: membersArtifact.id, title: 'Still mine' }),
    ).resolves.toMatchObject({ title: 'Still mine' })
    await api.delete({ id: membersArtifact.id })
  })

  it('answers 404 for an artifact of another organization', async () => {
    const { owner } = await organization()
    const other = await organization()
    const theirs = await t.client(other.owner.headers).artifacts.create(report('Secret'))
    const api = t.client(owner.headers).artifacts

    for (const call of [
      () => api.get({ id: theirs.id }),
      () => api.content({ id: theirs.id }),
      () => api.versions({ id: theirs.id }),
      () => api.publish({ id: theirs.id, content: 'x' }),
      () => api.rename({ id: theirs.id, title: 'Mine' }),
      () => api.delete({ id: theirs.id }),
      () => api.get({ id: randomUUID() }),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 404 })
    }
  })

  it('follows a custom role: without artifact read nothing is listed; without workspace read no workspace artifacts', async () => {
    const { owner } = await organization()
    const workspace = await t
      .client(owner.headers)
      .workspaces.create({ name: 'Deals', description: '' })
    const inWorkspace = await t
      .client(owner.headers)
      .artifacts.create({ ...report(), workspaceId: workspace.id })
    for (const [role, permission] of [
      ['auditor', { usage: ['read'] }],
      ['reader', { artifact: ['read'] }],
    ] as const) {
      await orgApi(t, owner.headers).post('create-role', {
        role,
        permission,
        organizationId: owner.organizationId,
      })
    }
    const auditor = await joinAs(t, owner.organizationId, `auditor${counter}@acme.com`, 'auditor')
    const reader = await joinAs(t, owner.organizationId, `reader${counter}@acme.com`, 'reader')

    await expect(t.client(auditor.headers).artifacts.list({})).rejects.toMatchObject({
      status: 403,
    })
    await expect(t.client(reader.headers).artifacts.list({})).resolves.toEqual([])
    await expect(
      t.client(reader.headers).artifacts.list({ workspaceId: workspace.id }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      t.client(reader.headers).artifacts.content({ id: inWorkspace.id }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(t.client(reader.headers).artifacts.create(report())).rejects.toMatchObject({
      status: 403,
    })
  })

  it('answers 401 without a session', async () => {
    await expect(t.client().artifacts.list({})).rejects.toMatchObject({ status: 401 })
  })
})
