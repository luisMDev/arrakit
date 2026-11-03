import { type Permissions, allows } from '@arrakit/auth/permissions'
import type { FilePolicyView, FileView, UploadTicket } from '@arrakit/contract'
import {
  DomainError,
  type FileRow,
  NO_SUCH_WORKSPACE,
  type OrganizationScope,
  objectPathOf,
} from '@arrakit/db'
import { type Plan, contentTypeOf, filePolicyFor, fileRefusal } from '@arrakit/plans'

import { dayOf } from '../day'
import type { Logger } from '../observability/logger'
import { NOT_PERMITTED } from '../orpc/context'

export const UPLOAD_URL_SECONDS = 15 * 60
export const DOWNLOAD_URL_SECONDS = 5 * 60

export const NO_SUCH_FILE = 'No such file in your organization.'
export const NOT_UPLOADED = 'The file has not been uploaded yet. Upload it, then try again.'
export const UPLOAD_DIFFERS = 'The uploaded file is not the one announced. Upload it again.'

/** Who acts on files, in which organization, under which plan. */
export interface FileActor {
  userId: string
  permissions: Permissions
  plan: Plan
  scope: OrganizationScope
  log: Logger
}

export const fileView = (
  row: FileRow & { uploaderName?: string | null },
  viewerId: string,
): FileView => ({
  id: row.id,
  workspaceId: row.workspaceId,
  name: row.name,
  contentType: row.contentType,
  sizeBytes: row.sizeBytes,
  uploadedById: row.uploadedBy,
  uploaderName: row.uploaderName ?? null,
  uploadedByYou: row.uploadedBy === viewerId,
  uploadedOn: dayOf(row.createdAt),
})

export function filePolicyView(plan: Plan): FilePolicyView {
  const policy = filePolicyFor(plan)
  return { maxBytes: policy.maxBytes, extensions: Object.keys(policy.types) }
}

const forbidden = () => new DomainError('FORBIDDEN', NOT_PERMITTED)
const noSuchFile = () => new DomainError('NOT_FOUND', NO_SUCH_FILE)

function refusalMessage(name: string, plan: Plan): string | undefined {
  const policy = filePolicyFor(plan)
  switch (fileRefusal({ name, sizeBytes: 0 }, policy)) {
    case 'name':
      return `${JSON.stringify(name)} is not a usable file name.`
    case 'type':
      return `Files like ${name} cannot be uploaded. Allowed: ${Object.keys(policy.types).join(', ')}.`
    default:
      return undefined
  }
}

function checkCandidate(name: string, sizeBytes: number, plan: Plan): string {
  const refused = refusalMessage(name, plan)
  if (refused) throw new DomainError('BAD_REQUEST', refused)
  const policy = filePolicyFor(plan)
  if (fileRefusal({ name, sizeBytes }, policy) === 'size') {
    const megabytes = Math.floor(policy.maxBytes / 1_000_000)
    throw new DomainError('BAD_REQUEST', `${name} is larger than the ${megabytes} MB limit.`)
  }
  return contentTypeOf(name, policy)!
}

export function fileService(actor: FileActor) {
  const { scope, permissions, userId } = actor
  const objects = scope.objects

  async function enterScope(workspaceId: string | null): Promise<void> {
    if (!workspaceId) return
    if (!allows(permissions, { workspace: ['read'] })) throw forbidden()
    if (!(await scope.workspaces.get(workspaceId))) {
      throw new DomainError('NOT_FOUND', NO_SUCH_WORKSPACE)
    }
  }

  /** An uploaded file the actor may see. */
  async function readable(id: string): Promise<FileRow> {
    const row = await scope.files.get(id)
    if (!row || row.status !== 'ready') throw noSuchFile()
    if (row.workspaceId && !allows(permissions, { workspace: ['read'] })) throw forbidden()
    return row
  }

  /** The uploader may always change their own file; others need `action`. */
  async function changeable(id: string, action: 'update' | 'delete'): Promise<FileRow> {
    const row = await readable(id)
    if (row.uploadedBy !== userId && !allows(permissions, { file: [action] })) throw forbidden()
    return row
  }

  async function withUploader(row: FileRow): Promise<FileView> {
    return fileView((await scope.files.get(row.id)) ?? row, userId)
  }

  async function removeObject(row: FileRow): Promise<void> {
    try {
      await objects.remove(objectPathOf(row))
    } catch (err) {
      actor.log.error(
        { err, organizationId: row.organizationId, fileId: row.id },
        'file object not removed; it stays in the bucket',
      )
    }
  }

  return {
    policy: () => filePolicyView(actor.plan),

    async list(workspaceId: string | null): Promise<FileView[]> {
      await enterScope(workspaceId)
      return (await scope.files.list(workspaceId)).map((row) => fileView(row, userId))
    },

    async requestUpload(input: {
      workspaceId: string | null
      name: string
      sizeBytes: number
    }): Promise<UploadTicket> {
      await enterScope(input.workspaceId)
      const contentType = checkCandidate(input.name, input.sizeBytes, actor.plan)
      const row = await scope.files.reserve({ ...input, contentType, uploadedBy: userId })
      const upload = await objects.presignPut(objectPathOf(row), {
        contentType,
        contentLength: input.sizeBytes,
        expiresInSeconds: UPLOAD_URL_SECONDS,
      })
      return {
        file: fileView(row, userId),
        upload: { ...upload, expiresAt: upload.expiresAt.toISOString() },
      }
    },

    /** Only the uploader completes; completing an uploaded file again answers it as it is. */
    async completeUpload(id: string): Promise<FileView> {
      const row = await scope.files.get(id)
      if (!row || row.uploadedBy !== userId) throw noSuchFile()
      if (row.status === 'ready') return withUploader(row)
      const stored = await objects.head(objectPathOf(row))
      if (!stored) throw new DomainError('BAD_REQUEST', NOT_UPLOADED)
      if (stored.size !== row.sizeBytes || stored.contentType !== row.contentType) {
        await scope.files.remove(id)
        await removeObject(row)
        throw new DomainError('BAD_REQUEST', UPLOAD_DIFFERS)
      }
      const done = await scope.files.complete(id)
      if (!done) throw noSuchFile()
      return withUploader(done)
    },

    /** Stores bytes the server holds (MCP), through the same checks as a browser upload. */
    async upload(input: {
      workspaceId: string | null
      name: string
      bytes: Uint8Array
    }): Promise<FileView> {
      await enterScope(input.workspaceId)
      const sizeBytes = input.bytes.byteLength
      const contentType = checkCandidate(input.name, sizeBytes, actor.plan)
      const row = await scope.files.reserve({
        workspaceId: input.workspaceId,
        name: input.name,
        sizeBytes,
        contentType,
        uploadedBy: userId,
      })
      try {
        await objects.put(objectPathOf(row), input.bytes, contentType)
      } catch (err) {
        await scope.files.remove(row.id)
        throw err
      }
      const done = await scope.files.complete(row.id)
      if (!done) throw noSuchFile()
      return withUploader(done)
    },

    async downloadUrl(id: string): Promise<{ url: string; expiresAt: string }> {
      const row = await readable(id)
      const link = await objects.presignGet(objectPathOf(row), {
        downloadName: row.name,
        expiresInSeconds: DOWNLOAD_URL_SECONDS,
      })
      return { url: link.url, expiresAt: link.expiresAt.toISOString() }
    },

    async rename(id: string, name: string): Promise<FileView> {
      const row = await changeable(id, 'update')
      const refused = refusalMessage(name, actor.plan)
      if (refused) throw new DomainError('BAD_REQUEST', refused)
      if (contentTypeOf(name, filePolicyFor(actor.plan)) !== row.contentType) {
        throw new DomainError('BAD_REQUEST', `A rename must keep the file type of ${row.name}.`)
      }
      const renamed = await scope.files.rename(id, name)
      if (!renamed) throw noSuchFile()
      return withUploader(renamed)
    },

    async remove(id: string): Promise<void> {
      const row = await changeable(id, 'delete')
      if (!(await scope.files.remove(id))) throw noSuchFile()
      await removeObject(row)
    },
  }
}

export type FileService = ReturnType<typeof fileService>
