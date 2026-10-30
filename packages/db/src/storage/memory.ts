import { FileNotFoundError } from '../errors'
import { toFileKey, toFolderPrefix } from './file-key'
import type { OrganizationFiles, Storage } from './types'

interface Entry {
  bytes: Uint8Array
  contentType: string
  modifiedAt: Date
}

export function memoryStorage(): Storage & { objects: Map<string, Entry> } {
  const objects = new Map<string, Entry>()

  const forOrganization = (organizationId: string): OrganizationFiles => {
    const prefix = toFolderPrefix(organizationId, '')
    return {
      async putUrl(name) {
        return `memory://${toFileKey(organizationId, name)}?put`
      },
      async put(name, bytes, contentType) {
        objects.set(toFileKey(organizationId, name), {
          bytes: bytes.slice(),
          contentType,
          modifiedAt: new Date(),
        })
      },
      async get(name) {
        const entry = objects.get(toFileKey(organizationId, name))
        if (!entry) throw new FileNotFoundError(name)
        return entry.bytes.slice()
      },
      async copy(from, to) {
        const entry = objects.get(toFileKey(organizationId, from))
        if (!entry) throw new FileNotFoundError(from)
        objects.set(toFileKey(organizationId, to), {
          ...entry,
          bytes: entry.bytes.slice(),
          modifiedAt: new Date(),
        })
      },
      async getUrl(name) {
        return `memory://${toFileKey(organizationId, name)}`
      },
      async remove(names) {
        const keys = names.map((name) => toFileKey(organizationId, name))
        for (const key of keys) objects.delete(key)
      },
      async removePrefix(folder) {
        const start = toFolderPrefix(organizationId, folder)
        for (const key of [...objects.keys()]) if (key.startsWith(start)) objects.delete(key)
      },
      async list(folder) {
        const start = toFolderPrefix(organizationId, folder)
        return [...objects.entries()]
          .filter(([key]) => key.startsWith(start))
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => ({
            path: key.slice(prefix.length),
            size: entry.bytes.byteLength,
            modifiedAt: entry.modifiedAt.toISOString(),
          }))
      },
    }
  }

  return {
    kind: 'memory',
    objects,
    forOrganization,
    async probe() {},
    async close() {},
  }
}
