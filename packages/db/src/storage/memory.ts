import { FileNotFoundError } from '../errors'
import { toFileKey, toFolderPrefix } from './file-key'
import { DEFAULT_URL_EXPIRES_IN, type SignedStore, type UrlSigning, urlSigner } from './signed-url'
import type { OrganizationFiles, Storage } from './types'

interface Entry {
  bytes: Uint8Array
  contentType: string
  modifiedAt: Date
}

/**
 * Objects in a map. With `signing`, putUrl/getUrl are real presigned URLs answered by
 * `serveSigned`; without it they are inert `memory://` markers.
 */
export function memoryStorage(
  options: { signing?: UrlSigning } = {},
): Storage & { objects: Map<string, Entry> } {
  const objects = new Map<string, Entry>()
  const signer = options.signing && urlSigner(options.signing)
  const store: SignedStore = {
    async read(key) {
      const entry = objects.get(key)
      return entry && { bytes: entry.bytes.slice(), contentType: entry.contentType }
    },
    async write(key, bytes, contentType) {
      objects.set(key, { bytes: bytes.slice(), contentType, modifiedAt: new Date() })
    },
  }

  const forOrganization = (organizationId: string): OrganizationFiles => {
    const prefix = toFolderPrefix(organizationId, '')
    return {
      async putUrl(name, opts = {}) {
        const key = toFileKey(organizationId, name)
        if (!signer) return `memory://${key}?put`
        return signer.url(key, 'PUT', opts.expiresIn ?? DEFAULT_URL_EXPIRES_IN, opts.contentType)
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
      async getUrl(name, opts = {}) {
        const key = toFileKey(organizationId, name)
        if (!signer) return `memory://${key}`
        return signer.url(key, 'GET', opts.expiresIn ?? DEFAULT_URL_EXPIRES_IN)
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
    ...(signer ? { serveSigned: (request: Request) => signer.serve(request, store) } : {}),
  }
}
