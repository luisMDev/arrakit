import { randomUUID } from 'node:crypto'

import type { UploadTicket } from '@arrakit/contract'
import { LATE_UPLOAD_SECONDS, objectPathOf } from '@arrakit/db'
import { rawSql } from '@arrakit/db/testing'
import { BYTES_PER_GB as GB, filePolicyFor } from '@arrakit/plans'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { NOT_UPLOADED, UPLOAD_DIFFERS } from '../files/files'
import { noErrorReporter } from '../observability/error-reporter'
import { recordingLogger } from '../observability/logger'
import { type TestApp, createTestApp } from '../testing/app'
import { joinAs, orgApi, ownerOf } from '../testing/people'
import { registerJobs } from '../workers/job'
import { storagePurge } from '../workers/storage-purge'

describe('files', () => {
  let t: TestApp
  const { log } = recordingLogger()
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
  const send = (
    organizationId: string,
    ticket: UploadTicket,
    bytes: Uint8Array,
    contentType = ticket.upload.headers['content-type'],
  ) =>
    t.data.storage.put(
      organizationId,
      objectPathOf({ id: ticket.file.id, workspaceId: ticket.file.workspaceId }),
      bytes,
      contentType,
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
    const lifetimeMinutes = (Date.parse(ticket.upload.expiresAt) - Date.now()) / 60_000
    expect(lifetimeMinutes).toBeGreaterThan(119)
    expect(lifetimeMinutes).toBeLessThanOrEqual(120)
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

  it('throws away bytes that differ from the announced ones and keeps the reservation', async () => {
    const { owner } = await organization()
    const api = t.client(owner.headers).files
    const scope = t.data.asSystem(owner.organizationId)
    const ticket = await api.requestUpload({ name: 'a.txt', sizeBytes: 3 })
    send(owner.organizationId, ticket, new TextEncoder().encode('longer'))

    await expect(api.completeUpload({ id: ticket.file.id })).rejects.toMatchObject({
      status: 400,
      message: UPLOAD_DIFFERS,
    })
    expect(await scope.files.get(ticket.file.id)).toMatchObject({ status: 'pending' })
    expect(t.data.storage.objects.has(`${owner.organizationId}/files/${ticket.file.id}`)).toBe(
      false,
    )
    send(owner.organizationId, ticket, new TextEncoder().encode('abc'))
    await expect(api.completeUpload({ id: ticket.file.id })).resolves.toMatchObject({
      name: 'a.txt',
      sizeBytes: 3,
    })

    const html = await api.requestUpload({ name: 'b.txt', sizeBytes: 3 })
    send(owner.organizationId, html, new TextEncoder().encode('<a>'), 'text/html')
    await expect(api.completeUpload({ id: html.file.id })).rejects.toMatchObject({
      status: 400,
      message: UPLOAD_DIFFERS,
    })
    expect(await scope.files.get(html.file.id)).toMatchObject({ status: 'pending' })
    expect(t.data.storage.objects.has(`${owner.organizationId}/files/${html.file.id}`)).toBe(false)
  })

  it('keeps a mismatched upload counted against storage until it expires', async () => {
    const { owner } = await organization()
    const api = t.client(owner.headers).files
    await t.data.asSystem(owner.organizationId).files.reserve({
      workspaceId: null,
      name: 'archive.zip',
      contentType: 'application/zip',
      sizeBytes: 10 * GB - 3,
      uploadedBy: owner.userId,
    })
    const ticket = await api.requestUpload({ name: 'a.txt', sizeBytes: 3 })
    send(owner.organizationId, ticket, new TextEncoder().encode('tiny'))
    await expect(api.completeUpload({ id: ticket.file.id })).rejects.toMatchObject({
      message: UPLOAD_DIFFERS,
    })

    await expect(api.requestUpload({ name: 'one-more.pdf', sizeBytes: 1 })).rejects.toMatchObject({
      status: 402,
    })
  })

  it('purges again, once its upload link lapses, the object of a file deleted while the link works', async () => {
    const { owner } = await organization()
    await registerJobs([storagePurge], { data: t.data, log, errors: noErrorReporter })
    const bytes = new TextEncoder().encode('hello')
    const api = t.client(owner.headers).files
    const ticket = await api.requestUpload({ name: 'late.txt', sizeBytes: bytes.byteLength })
    send(owner.organizationId, ticket, bytes)
    await api.completeUpload({ id: ticket.file.id })
    const key = `${owner.organizationId}/files/${ticket.file.id}`

    await api.delete({ id: ticket.file.id })
    expect(t.data.storage.objects.has(key)).toBe(false)
    const purge = t.data.jobs.sent.at(-1)!
    expect(purge).toMatchObject({
      name: 'storage-purge',
      data: { organizationId: owner.organizationId, path: `files/${ticket.file.id}` },
    })
    const startAfter = purge.options.startAfter as Date
    const reservedAt = Date.now() - 1000
    expect(startAfter.getTime()).toBeGreaterThan(reservedAt + LATE_UPLOAD_SECONDS * 1000)
    expect(startAfter.getTime()).toBeLessThanOrEqual(Date.now() + LATE_UPLOAD_SECONDS * 1000)

    send(owner.organizationId, ticket, new Uint8Array(1000))
    await t.data.jobs.run('storage-purge')
    expect(t.data.storage.objects.has(key)).toBe(false)
  })

  it('frees the reservation when the upload link cannot be signed', async () => {
    const { owner } = await organization()
    const api = t.client(owner.headers).files
    const forOrganization = t.data.storage.forOrganization.bind(t.data.storage)
    const spy = vi.spyOn(t.data.storage, 'forOrganization').mockImplementation((id) => {
      const objects = forOrganization(id)
      return {
        ...objects,
        presignPut: () => Promise.reject(new Error('storage unavailable')),
      }
    })
    try {
      await expect(api.requestUpload({ name: 'a.pdf', sizeBytes: 4 })).rejects.toMatchObject({
        status: 500,
      })
    } finally {
      spy.mockRestore()
    }

    const { rows } = await rawSql(t.data)(
      'select count(*)::int as count from files where organization_id = $1',
      [owner.organizationId],
    )
    expect(rows[0]?.count).toBe(0)
    await expect(api.requestUpload({ name: 'a.pdf', sizeBytes: 4 })).resolves.toMatchObject({
      file: { name: 'a.pdf' },
    })
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
    await t.data.asSystem(owner.organizationId).files.reserve({
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
    expect(await t.data.asSystem(owner.organizationId).files.get(file.id)).toBeUndefined()
    const purge = {
      name: 'storage-purge',
      data: { organizationId: owner.organizationId, folder: `workspaces/${workspace.id}/` },
    }
    const [now, later] = t.data.jobs.sent.slice(-2)
    expect(now).toMatchObject(purge)
    expect(now!.options.startAfter).toBeUndefined()
    expect(later).toMatchObject({ ...purge, options: { startAfter: expect.any(Date) } })
  })

  it('links a download named after the file, and renames keeping the type', async () => {
    const { owner } = await organization()
    const file = await uploaded(owner, 'Q3 report.pdf', '%PDF')
    const api = t.client(owner.headers).files

    const link = await api.downloadUrl({ id: file.id })
    expect(new URL(link.url).searchParams.get('download')).toBe('Q3 report.pdf')

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
