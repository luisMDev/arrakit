import { StorageApiError, StorageClient, type StorageError } from '@supabase/storage-js'

import type { SupabaseStorageConfig } from '../config'
import { UPLOAD_URL_SECONDS, expiryIn, folderPrefix, objectKey } from './folder'
import type { OrganizationObjects, Storage } from './types'

export const FILES_BUCKET = 'files'

const REMOVE_BATCH = 100

type Answer<T> = { data: T; error: null } | { data: null; error: StorageError }

function unwrap<T>({ data, error }: Answer<T>): T {
  if (error) throw error
  return data as T
}

/** The client's own rule for a missing object (see `exists`). */
const isMissingObject = (err: StorageError) =>
  err instanceof StorageApiError &&
  (err.code === 'NoSuchKey' || (err.status === 404 && err.code === undefined))

export function supabaseStorage(
  config: SupabaseStorageConfig,
  options: { fetch?: typeof fetch; listPageSize?: number } = {},
): Storage {
  const listPageSize = options.listPageSize ?? 1000
  const client = new StorageClient(
    `${config.url.replace(/\/+$/, '')}/storage/v1`,
    { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}` },
    options.fetch,
  )
  const bucket = client.from(FILES_BUCKET)

  async function listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = []
    let cursor: string | undefined
    for (;;) {
      const page = unwrap(
        await bucket.listV2({
          prefix,
          limit: listPageSize,
          with_delimiter: false,
          ...(cursor ? { cursor } : {}),
        }),
      )
      for (const object of page.objects) {
        const key = object.key ?? object.name
        if (!key.startsWith(prefix)) {
          throw new Error(`[data] storage listed ${key} outside ${prefix}`)
        }
        keys.push(key)
      }
      if (!page.hasNext || !page.nextCursor) return keys
      cursor = page.nextCursor
    }
  }

  const forOrganization = (organizationId: string): OrganizationObjects => {
    const orgPrefix = folderPrefix(organizationId, '')
    const keyOf = (path: string) => objectKey(organizationId, path)
    return {
      async removePrefix(folder) {
        const keys = await listKeys(folderPrefix(organizationId, folder))
        for (let i = 0; i < keys.length; i += REMOVE_BATCH) {
          unwrap(await bucket.remove(keys.slice(i, i + REMOVE_BATCH)))
        }
      },
      async list(folder) {
        const keys = await listKeys(folderPrefix(organizationId, folder))
        return keys.map((key) => ({ path: key.slice(orgPrefix.length) }))
      },
      async presignPut(path, { contentType }) {
        const { signedUrl } = unwrap(await bucket.createSignedUploadUrl(keyOf(path)))
        return {
          url: signedUrl,
          headers: { 'content-type': contentType },
          expiresAt: expiryIn(UPLOAD_URL_SECONDS),
        }
      },
      async presignGet(path, { downloadName, expiresInSeconds }) {
        const { signedUrl } = unwrap(await bucket.createSignedUrl(keyOf(path), expiresInSeconds))
        const url = new URL(signedUrl)
        // The client's own `download` option encodes the name twice.
        url.searchParams.set('download', downloadName)
        return { url: url.toString(), expiresAt: expiryIn(expiresInSeconds) }
      },
      async head(path) {
        const { data, error } = await bucket.info(keyOf(path))
        if (error) {
          if (isMissingObject(error)) return undefined
          throw error
        }
        return {
          size: data.size ?? 0,
          contentType: data.contentType ?? 'application/octet-stream',
        }
      },
      async put(path, bytes, contentType) {
        unwrap(await bucket.upload(keyOf(path), bytes, { contentType }))
      },
      async remove(path) {
        unwrap(await bucket.remove([keyOf(path)]))
      },
    }
  }

  return {
    forOrganization,
    async probe() {
      unwrap(await client.getBucket(FILES_BUCKET))
    },
    async close() {},
  }
}
