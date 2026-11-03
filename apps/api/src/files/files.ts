import { type Permissions, allows } from '@arrakit/auth/permissions'
import type { FileView, UploadTicket } from '@arrakit/contract'
import {
  DomainError,
  type FileRow,
  NO_SUCH_WORKSPACE,
  type OrganizationScope,
  objectPathOf,
} from '@arrakit/db'
import {
  type FilePolicy,
  type Plan,
  contentTypeOf,
  filePolicyFor,
  fileRefusal,
} from '@arrakit/plans'

import { dayOf } from '../day'
import type { Logger } from '../observability/logger'
import { NOT_PERMITTED } from '../orpc/context'

export const UPLOAD_URL_SECONDS = 15 * 60
export const DOWNLOAD_URL_SECONDS = 5 * 60

export const NO_SUCH_FILE = 'No such file in your organization.'
export const NOT_UPLOADED = 'The file has not been uploaded yet. Upload it, then try again.'
export const UPLOAD_DIFFERS = 'The uploaded file is not the one announced. Upload it again.'

/** Who acts on files, in which organization; `plan` is the organization's. */
export interface FileActor {
  userId: string
  permissions: Permissions
  plan: string
  scope: OrganizationScope
  log: Logger
}

type ViewedRow = FileRow & { uploaderName?: string | null }

const fileView = (row: ViewedRow, viewerId: string): FileView => ({
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

const forbidden = () => new DomainError('FORBIDDEN', NOT_PERMITTED)
const noSuchFile = () => new DomainError('NOT_FOUND', NO_SUCH_FILE)

/** The content type `policy` stores the file as; BAD_REQUEST saying why when it refuses it. */
function acceptedType(name: string, sizeBytes: number, policy: FilePolicy): string {
  switch (fileRefusal({ name, sizeBytes }, policy)) {
    case 'name':
      throw new DomainError('BAD_REQUEST', `${JSON.stringify(name)} is not a usable file name.`)
    case 'type': {
      const allowed = Object.keys(policy.types).join(', ')
      throw new DomainError(
        'BAD_REQUEST',
        `Files like ${name} cannot be uploaded. Allowed: ${allowed}.`,
      )
    }
    case 'size': {
      const megabytes = Math.floor(policy.maxBytes / 1_000_000)
      throw new DomainError('BAD_REQUEST', `${name} is larger than the ${megabytes} MB limit.`)
    }
    default:
      return contentTypeOf(name, policy)!
  }
}

/** Removes a file's bytes; a failure is logged, not thrown (the row is already gone). */
export async function removeFileObject(
  scope: OrganizationScope,
  file: FileRow,
  log: Logger,
): Promise<void> {
  try {
    await scope.objects.remove(objectPathOf(file))
  } catch (err) {
    log.error(
      { err, organizationId: file.organizationId, fileId: file.id },
      'file object not removed; it stays in the bucket',
    )
  }
}

export function fileService(actor: FileActor) {
  const { scope, permissions, userId, log } = actor
  const policy = filePolicyFor(actor.plan as Plan)
  const view = (row: ViewedRow) => fileView(row, userId)

  const mayReadWorkspaces = (workspaceId: string | null) => {
    if (workspaceId && !allows(permissions, { workspace: ['read'] })) throw forbidden()
  }

  /** An uploaded file the actor may see. */
  async function readable(id: string) {
    const row = await scope.files.get(id)
    if (!row || row.status !== 'ready') throw noSuchFile()
    mayReadWorkspaces(row.workspaceId)
    return row
  }

  /** The uploader may always change their own file; others need `action`. */
  async function changeable(id: string, action: 'update' | 'delete') {
    const row = await readable(id)
    if (row.uploadedBy !== userId && !allows(permissions, { file: [action] })) throw forbidden()
    return row
  }

  /** A pending file, after the policy, the workspace and the quota accepted it. */
  function reserve(input: { workspaceId: string | null; name: string; sizeBytes: number }) {
    mayReadWorkspaces(input.workspaceId)
    const contentType = acceptedType(input.name, input.sizeBytes, policy)
    return scope.files.reserve({ ...input, contentType, uploadedBy: userId })
  }

  async function completed(id: string): Promise<FileView> {
    if (!(await scope.files.complete(id))) throw noSuchFile()
    return view((await scope.files.get(id))!)
  }

  return {
    async list(workspaceId: string | null): Promise<FileView[]> {
      mayReadWorkspaces(workspaceId)
      if (workspaceId && !(await scope.workspaces.get(workspaceId))) {
        throw new DomainError('NOT_FOUND', NO_SUCH_WORKSPACE)
      }
      return (await scope.files.list(workspaceId)).map(view)
    },

    async requestUpload(input: {
      workspaceId: string | null
      name: string
      sizeBytes: number
    }): Promise<UploadTicket> {
      const row = await reserve(input)
      const upload = await scope.objects.presignPut(objectPathOf(row), {
        contentType: row.contentType,
        contentLength: row.sizeBytes,
        expiresInSeconds: UPLOAD_URL_SECONDS,
      })
      return { file: view(row), upload: { ...upload, expiresAt: upload.expiresAt.toISOString() } }
    },

    /** Only the uploader completes; completing an uploaded file again answers it as it is. */
    async completeUpload(id: string): Promise<FileView> {
      const row = await scope.files.get(id)
      if (!row || row.uploadedBy !== userId) throw noSuchFile()
      if (row.status === 'ready') return view(row)
      const stored = await scope.objects.head(objectPathOf(row))
      if (!stored) throw new DomainError('BAD_REQUEST', NOT_UPLOADED)
      if (stored.size !== row.sizeBytes || stored.contentType !== row.contentType) {
        await scope.files.remove(id)
        await removeFileObject(scope, row, log)
        throw new DomainError('BAD_REQUEST', UPLOAD_DIFFERS)
      }
      return completed(id)
    },

    /** Stores bytes the server holds (MCP), through the same checks as a browser upload. */
    async upload(input: {
      workspaceId: string | null
      name: string
      bytes: Uint8Array
    }): Promise<FileView> {
      const { bytes, ...file } = input
      const row = await reserve({ ...file, sizeBytes: bytes.byteLength })
      try {
        await scope.objects.put(objectPathOf(row), bytes, row.contentType)
      } catch (err) {
        await scope.files.remove(row.id)
        throw err
      }
      return completed(row.id)
    },

    async downloadUrl(id: string): Promise<{ url: string; expiresAt: string }> {
      const row = await readable(id)
      const link = await scope.objects.presignGet(objectPathOf(row), {
        downloadName: row.name,
        expiresInSeconds: DOWNLOAD_URL_SECONDS,
      })
      return { url: link.url, expiresAt: link.expiresAt.toISOString() }
    },

    async rename(id: string, name: string): Promise<FileView> {
      const row = await changeable(id, 'update')
      if (acceptedType(name, row.sizeBytes, policy) !== row.contentType) {
        throw new DomainError('BAD_REQUEST', `A rename must keep the file type of ${row.name}.`)
      }
      const renamed = await scope.files.rename(id, name)
      if (!renamed) throw noSuchFile()
      return view({ ...renamed, uploaderName: row.uploaderName })
    },

    async remove(id: string): Promise<void> {
      const row = await changeable(id, 'delete')
      if (!(await scope.files.remove(id))) throw noSuchFile()
      await removeFileObject(scope, row, log)
    },
  }
}
