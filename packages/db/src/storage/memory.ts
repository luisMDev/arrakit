import { attachmentDisposition, expiryIn, folderPrefix, objectKey } from './folder'
import type { ObjectHead, OrganizationObjects, Storage } from './types'

export interface MemoryObject extends ObjectHead {
  bytes: Uint8Array
}

export interface MemoryStorage extends Storage {
  /** By key, `<organizationId>/<path>`. */
  objects: Map<string, MemoryObject>
  /** Stores an object as a finished upload would. */
  put(organizationId: string, path: string, bytes?: Uint8Array, contentType?: string): void
}

export function memoryStorage(): MemoryStorage {
  const objects = new Map<string, MemoryObject>()

  const store = (key: string, bytes: Uint8Array, contentType: string) => {
    objects.set(key, { bytes, size: bytes.byteLength, contentType })
  }

  const forOrganization = (organizationId: string): OrganizationObjects => {
    const own = (folder: string) => {
      const start = folderPrefix(organizationId, folder)
      return [...objects.keys()].filter((key) => key.startsWith(start)).sort()
    }
    const keyOf = (path: string) => objectKey(organizationId, path)
    return {
      async removePrefix(folder) {
        for (const key of own(folder)) objects.delete(key)
      },
      async list(folder) {
        const prefix = folderPrefix(organizationId, '')
        return own(folder).map((key) => ({ path: key.slice(prefix.length) }))
      },
      async presignPut(path, { contentType, expiresInSeconds }) {
        return {
          url: `memory://${keyOf(path)}`,
          headers: { 'content-type': contentType },
          expiresAt: expiryIn(expiresInSeconds),
        }
      },
      async presignGet(path, { downloadName, expiresInSeconds }) {
        const disposition = encodeURIComponent(attachmentDisposition(downloadName))
        return {
          url: `memory://${keyOf(path)}?response-content-disposition=${disposition}`,
          expiresAt: expiryIn(expiresInSeconds),
        }
      },
      async head(path) {
        const found = objects.get(keyOf(path))
        return found && { size: found.size, contentType: found.contentType }
      },
      async put(path, bytes, contentType) {
        store(keyOf(path), bytes, contentType)
      },
      async remove(path) {
        objects.delete(keyOf(path))
      },
    }
  }

  return {
    objects,
    forOrganization,
    put(organizationId, path, bytes = new Uint8Array(), contentType = 'application/octet-stream') {
      store(objectKey(organizationId, path), bytes, contentType)
    },
    async probe() {},
    async close() {},
  }
}
