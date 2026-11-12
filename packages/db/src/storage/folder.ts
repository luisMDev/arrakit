import { toOrganizationId } from '../organization-id'

const MAX_KEY_BYTES = 1024
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

function usablePath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\') || CONTROL.test(path)) return false
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/** `''` is the whole organization; otherwise the folder must end with exactly one `/`. */
export function folderPrefix(organizationId: string, folder: string): string {
  const prefix = `${toOrganizationId(organizationId)}/`
  if (folder === '') return prefix
  const key = prefix + folder
  if (
    !folder.endsWith('/') ||
    !usablePath(folder.slice(0, -1)) ||
    Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES
  ) {
    throw new Error(`[data] not a usable folder: ${JSON.stringify(folder)}`)
  }
  return key
}

/** The bucket key of one object; the path must not end with `/`. */
export function objectKey(organizationId: string, path: string): string {
  const key = `${toOrganizationId(organizationId)}/${path}`
  if (!usablePath(path) || Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) {
    throw new Error(`[data] not a usable object path: ${JSON.stringify(path)}`)
  }
  return key
}

/** Supabase Storage fixes how long a signed upload URL lasts; it is not a setting. */
export const UPLOAD_URL_SECONDS = 2 * 60 * 60

/**
 * How long after a file is reserved its upload link may still store bytes: the link cannot be
 * revoked and uploads again once its object is removed, so this is its lifetime plus an hour for
 * a transfer that started just in time.
 */
export const LATE_UPLOAD_SECONDS = UPLOAD_URL_SECONDS + 60 * 60

/** When the upload link of a file reserved at `reservedAt` can no longer store bytes. */
export const uploadsSettleAt = (reservedAt: Date): Date =>
  new Date(reservedAt.getTime() + LATE_UPLOAD_SECONDS * 1000)

/** `seconds` from now, when a presigned URL stops working. */
export const expiryIn = (seconds: number): Date => new Date(Date.now() + seconds * 1000)
