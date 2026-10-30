import { folderPrefix } from './folder'
import type { OrganizationFiles, Storage } from './types'

export interface MemoryStorage extends Storage {
  /** Object keys, `<organizationId>/<path>`. */
  objects: Set<string>
  put(organizationId: string, path: string): void
}

export function memoryStorage(): MemoryStorage {
  const objects = new Set<string>()

  const forOrganization = (organizationId: string): OrganizationFiles => {
    const own = (folder: string) => {
      const start = folderPrefix(organizationId, folder)
      return [...objects].filter((key) => key.startsWith(start)).sort()
    }
    return {
      async removePrefix(folder) {
        for (const key of own(folder)) objects.delete(key)
      },
      async list(folder) {
        const prefix = folderPrefix(organizationId, '')
        return own(folder).map((key) => ({ path: key.slice(prefix.length) }))
      },
    }
  }

  return {
    objects,
    forOrganization,
    put(organizationId, path) {
      objects.add(`${folderPrefix(organizationId, '')}${path}`)
    },
    async probe() {},
    async close() {},
  }
}
