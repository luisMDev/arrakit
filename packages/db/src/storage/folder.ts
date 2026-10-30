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
