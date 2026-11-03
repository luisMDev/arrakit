import { randomUUID } from 'node:crypto'

import type { UploadTicket } from '@arrakit/contract'
import { objectPathOf } from '@arrakit/db'
import { BYTES_PER_GB as GB, filePolicyFor } from '@arrakit/plans'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NOT_UPLOADED, UPLOAD_DIFFERS } from '../files/files'
import { type TestApp, createTestApp } from '../testing/app'
import { joinAs, orgApi, ownerOf } from '../testing/people'

describe('files', () => {
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

  /** What the browser does with the presigned URL, in the in-memory bucket. */
  const send = (organizationId: string, ticket: UploadTicket, bytes: Uint8Array) =>
    t.data.storage.put(
      organizationId,
      objectPathOf({ id: ticket.file.id, workspaceId: ticket.file.workspaceId }),
      bytes,
      ticket.upload.headers['content-type'],
    )

  const uploaded = async (
    who: { headers: Headers; organizationId: string },
    name: string,
    content = 'hello',
    workspaceId?: string,
  ) => {
    const bytes = new TextEncoder().encode(content)
    const api = t.client(who.headers).files
    const ticket = await api.requestUpload({ name, sizeBytes: bytes.byteLength, workspaceId })
    send(who.organizationId, ticket, bytes)
    return api.completeUpload({ id: ticket.file.id })
  }

  it('uploads through a presigned URL, then lists the file once it is complete', async () => {
    const { owner } = await organization()
    const api = t.client(owner.headers).files

    const ticket = await api.requestUpload({ name: 'Deck.PDF', sizeBytes: 4 })
    expect(ticket.upload).toEqual({
      url: expect.stringContaining(`${owner.organizationId}/files/${ticket.file.id}`),
      headers: { 'content-type': 'application/pdf' },
      expiresAt: expect.any(String),
    })
    await expect(api.list({})).resolves.toEqual([])

    await expect(api.completeUpload({ id: ticket.file.id })).rejects.toMatchObject({
      status: 400,
      message: NOT_UPLOADED,
    })
    send(owner.organizationId, ticket, new TextEncoder().encode('%PDF'))
    const file = await api.completeUpload({ id: ticket.file.id })
    expect(file).toEqual({
      id: ticket.file.id,
      workspaceId: null,
      name: 'Deck.PDF',
      contentType: 'application/pdf',
      sizeBytes: 4,
      uploadedById: owner.userId,
      uploaderName: expect.any(String),
      uploadedByYou: true,
      uploadedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
    await expect(api.completeUpload({ id: ticket.file.id })).resolves.toEqual(file)
    await expect(api.list({})).resolves.toEqual([file])
    expect(t.data.jobs.published.at(-1)).toMatchObject({
      event: 'file.uploaded',
      data: { fileId: file.id, organizationId: owner.organizationId },
    })
  })

  it('throws away an upload whose bytes differ from the announced ones', async () => {
    const { owner } = await organization()
    const api = t.client(owner.headers).files
    const ticket = await api.requestUpload({ name: 'a.txt', sizeBytes: 3 })
    send(owner.organizationId, ticket, new TextEncoder().encode('longer'))

    await expect(api.completeUpload({ id: ticket.file.id })).rejects.toMatchObject({
      status: 400,
      message: UPLOAD_DIFFERS,
    })
    expect(
      await t.data.forOrganization(owner.organizationId).files.get(ticket.file.id),
    ).toBeUndefined()
    expect(t.data.storage.objects.has(`${owner.organizationId}/files/${ticket.file.id}`)).toBe(
      false,
    )
  })

  it('refuses what the plan’s policy does not allow, with a 400', async () => {
    const { owner } = await organization()
    const api = t.client(owner.headers).files
    await expect(api.requestUpload({ name: 'tool.exe', sizeBytes: 1 })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/^Files like tool.exe cannot be uploaded/),
    })
    await expect(
      api.requestUpload({ name: 'big.pdf', sizeBytes: filePolicyFor('free').maxBytes + 1 }),
    ).rejects.toMatchObject({ status: 400, message: 'big.pdf is larger than the 50 MB limit.' })
    await expect(api.requestUpload({ name: 'a/b.pdf', sizeBytes: 1 })).rejects.toMatchObject({
      status: 400,
    })
  })

  it('answers 402 when the file does not fit in the organization’s storage', async () => {
    const { owner } = await organization()
    await t.data.forOrganization(owner.organizationId).files.reserve({
      workspaceId: null,
      name: 'archive.zip',
      contentType: 'application/zip',
      sizeBytes: 10 * GB,
      uploadedBy: owner.userId,
    })
    await expect(
      t.client(owner.headers).files.requestUpload({ name: 'one-more.pdf', sizeBytes: 1 }),
    ).rejects.toMatchObject({
      status: 402,
      data: { metric: 'storage_gb', requested: 1, available: 0 },
    })
  })

  it('answers 409 for a name already uploaded in the same place', async () => {
    const { owner } = await organization()
    await uploaded(owner, 'Notes.md')
    await expect(
      t.client(owner.headers).files.requestUpload({ name: 'notes.MD', sizeBytes: 1 }),
    ).rejects.toMatchObject({ status: 409, message: 'A file named notes.MD already exists here.' })
  })

  it('keeps workspace files apart from the organization’s, and refuses another’s workspace', async () => {
    const { owner } = await organization()
    const other = await organization()
    const workspace = await t
      .client(owner.headers)
      .workspaces.create({ name: 'Deals', description: '' })
    const theirs = await t
      .client(other.owner.headers)
      .workspaces.create({ name: 'X', description: '' })
    await uploaded(owner, 'deal.pdf', '%PDF', workspace.id)
    await uploaded(owner, 'org.pdf', '%PDF')
    const api = t.client(owner.headers).files

    expect((await api.list({ workspaceId: workspace.id })).map((f) => f.name)).toEqual(['deal.pdf'])
    expect((await api.list({})).map((f) => f.name)).toEqual(['org.pdf'])
    await expect(api.list({ workspaceId: theirs.id })).rejects.toMatchObject({ status: 404 })
    await expect(
      api.requestUpload({ name: 'x.pdf', sizeBytes: 1, workspaceId: theirs.id }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('deleting a workspace deletes its files and purges their bytes', async () => {
    const { owner } = await organization()
    const workspace = await t
      .client(owner.headers)
      .workspaces.create({ name: 'Deals', description: '' })
    const file = await uploaded(owner, 'deal.pdf', '%PDF', workspace.id)

    await t.client(owner.headers).workspaces.delete({ id: workspace.id })
    expect(await t.data.forOrganization(owner.organizationId).files.get(file.id)).toBeUndefined()
    expect(t.data.jobs.sent.at(-1)).toMatchObject({
      name: 'storage-purge',
      data: { organizationId: owner.organizationId, folder: `workspaces/${workspace.id}/` },
    })
  })

  it('links a download named after the file, and renames keeping the type', async () => {
    const { owner } = await organization()
    const file = await uploaded(owner, 'Q3 report.pdf', '%PDF')
    const api = t.client(owner.headers).files

    const link = await api.downloadUrl({ id: file.id })
    expect(decodeURIComponent(link.url)).toContain('filename="Q3 report.pdf"')

    await expect(api.rename({ id: file.id, name: 'Q4 report.pdf' })).resolves.toMatchObject({
      id: file.id,
      name: 'Q4 report.pdf',
    })
    await expect(api.rename({ id: file.id, name: 'Q4 report.txt' })).rejects.toMatchObject({
      status: 400,
    })
    expect(t.data.jobs.published.at(-1)).toMatchObject({
      event: 'file.renamed',
      data: { name: 'Q4 report.pdf', previousName: 'Q3 report.pdf' },
    })
  })

  it('deletes a file and its bytes', async () => {
    const { owner } = await organization()
    const file = await uploaded(owner, 'old.txt')
    await t.client(owner.headers).files.delete({ id: file.id })

    await expect(t.client(owner.headers).files.list({})).resolves.toEqual([])
    expect(t.data.storage.objects.has(`${owner.organizationId}/files/${file.id}`)).toBe(false)
    await expect(t.client(owner.headers).files.delete({ id: file.id })).rejects.toMatchObject({
      status: 404,
    })
  })

  it('lets a member upload and change their own files, not another person’s', async () => {
    const { owner, member } = await organization()
    const ownersFile = await uploaded(owner, 'board.pdf', '%PDF')
    const membersFile = await uploaded(
      { headers: member.headers, organizationId: owner.organizationId },
      'mine.txt',
    )
    const api = t.client(member.headers).files

    expect((await api.list({})).map((f) => [f.name, f.uploadedByYou])).toEqual([
      ['board.pdf', false],
      ['mine.txt', true],
    ])
    await expect(api.rename({ id: ownersFile.id, name: 'x.pdf' })).rejects.toMatchObject({
      status: 403,
    })
    await expect(api.delete({ id: ownersFile.id })).rejects.toMatchObject({ status: 403 })
    await expect(api.rename({ id: membersFile.id, name: 'ours.txt' })).resolves.toMatchObject({
      name: 'ours.txt',
    })
    await api.delete({ id: membersFile.id })
    await t.client(owner.headers).files.delete({ id: ownersFile.id })
  })

  it('lets only the uploader complete an upload', async () => {
    const { owner, member } = await organization()
    const ticket = await t
      .client(owner.headers)
      .files.requestUpload({ name: 'a.txt', sizeBytes: 1 })
    await expect(
      t.client(member.headers).files.completeUpload({ id: ticket.file.id }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('answers 404 for a file of another organization', async () => {
    const { owner } = await organization()
    const other = await organization()
    const theirs = await uploaded(other.owner, 'secret.pdf', '%PDF')
    const api = t.client(owner.headers).files

    for (const call of [
      () => api.downloadUrl({ id: theirs.id }),
      () => api.rename({ id: theirs.id, name: 'mine.pdf' }),
      () => api.delete({ id: theirs.id }),
      () => api.completeUpload({ id: theirs.id }),
      () => api.downloadUrl({ id: randomUUID() }),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 404 })
    }
  })

  it('follows a custom role: without file read nothing is listed; without workspace read no workspace files', async () => {
    const { owner } = await organization()
    const workspace = await t
      .client(owner.headers)
      .workspaces.create({ name: 'Deals', description: '' })
    const file = await uploaded(owner, 'deal.pdf', '%PDF', workspace.id)
    for (const [role, permission] of [
      ['auditor', { usage: ['read'] }],
      ['archivist', { file: ['read'] }],
    ] as const) {
      await orgApi(t, owner.headers).post('create-role', {
        role,
        permission,
        organizationId: owner.organizationId,
      })
    }
    const auditor = await joinAs(t, owner.organizationId, `auditor${counter}@acme.com`, 'auditor')
    const archivist = await joinAs(
      t,
      owner.organizationId,
      `archivist${counter}@acme.com`,
      'archivist',
    )

    await expect(t.client(auditor.headers).files.list({})).rejects.toMatchObject({ status: 403 })
    await expect(t.client(archivist.headers).files.list({})).resolves.toEqual([])
    await expect(
      t.client(archivist.headers).files.list({ workspaceId: workspace.id }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      t.client(archivist.headers).files.downloadUrl({ id: file.id }),
    ).rejects.toMatchObject({
      status: 403,
    })
    await expect(
      t.client(archivist.headers).files.requestUpload({ name: 'a.txt', sizeBytes: 1 }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('answers 401 without a session', async () => {
    await expect(t.client().files.list({})).rejects.toMatchObject({ status: 401 })
  })
})
