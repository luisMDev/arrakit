import { access, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

import { FileNotFoundError } from '../errors'
import { toFileKey, toFolderPrefix } from './file-key'
import { DEFAULT_URL_EXPIRES_IN, type SignedStore, type UrlSigning, urlSigner } from './signed-url'
import type { OrganizationFiles, Storage, StoredFile } from './types'

const isMissing = (err: unknown) => (err as { code?: string }).code === 'ENOENT'

async function walk(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (isMissing(err)) return []
    throw err
  }
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(path)))
    else files.push(path)
  }
  return files
}

const DEFAULT_TYPE = 'application/octet-stream'
/** Content types live beside the organizations' folders, so list() never sees them. */
const TYPES_DIR = '.types'

/**
 * Files under `root/<orgId>/...`, each one's content type under `root/.types/...`. With `signing`,
 * putUrl/getUrl hand out presigned URLs that `serveSigned` answers; without it they throw.
 */
export function localStorage(root: string, options: { signing?: UrlSigning } = {}): Storage {
  const pathOf = (key: string) => join(root, ...key.split('/'))
  const typePathOf = (key: string) => join(root, TYPES_DIR, ...key.split('/'))
  const signer = options.signing && urlSigner(options.signing)
  const noSigning = () => new Error('[data] local storage does not presign URLs without a secret')

  const writeKey = async (key: string, bytes: Uint8Array, contentType: string) => {
    const path = pathOf(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
    await mkdir(dirname(typePathOf(key)), { recursive: true })
    await writeFile(typePathOf(key), contentType)
  }
  const typeOf = async (key: string) => {
    try {
      return (await readFile(typePathOf(key), 'utf8')) || DEFAULT_TYPE
    } catch (err) {
      if (isMissing(err)) return DEFAULT_TYPE
      throw err
    }
  }
  const store: SignedStore = {
    async read(key) {
      try {
        return {
          bytes: new Uint8Array(await readFile(pathOf(key))),
          contentType: await typeOf(key),
        }
      } catch (err) {
        if (isMissing(err)) return undefined
        throw err
      }
    },
    write: writeKey,
  }

  const forOrganization = (organizationId: string): OrganizationFiles => {
    const orgDir = pathOf(toFolderPrefix(organizationId, '').slice(0, -1))
    return {
      async putUrl(name, opts = {}) {
        const key = toFileKey(organizationId, name)
        if (!signer) throw noSigning()
        return signer.url(key, 'PUT', opts.expiresIn ?? DEFAULT_URL_EXPIRES_IN, opts.contentType)
      },
      async put(name, bytes, contentType) {
        await writeKey(toFileKey(organizationId, name), bytes, contentType)
      },
      async get(name) {
        try {
          return new Uint8Array(await readFile(pathOf(toFileKey(organizationId, name))))
        } catch (err) {
          if (isMissing(err)) throw new FileNotFoundError(name)
          throw err
        }
      },
      async copy(from, to) {
        const target = pathOf(toFileKey(organizationId, to))
        await mkdir(dirname(target), { recursive: true })
        const fromKey = toFileKey(organizationId, from)
        try {
          await copyFile(pathOf(fromKey), target)
        } catch (err) {
          if (isMissing(err)) throw new FileNotFoundError(from)
          throw err
        }
        const toKey = toFileKey(organizationId, to)
        await mkdir(dirname(typePathOf(toKey)), { recursive: true })
        await writeFile(typePathOf(toKey), await typeOf(fromKey))
      },
      async getUrl(name, opts = {}) {
        const key = toFileKey(organizationId, name)
        if (!signer) throw noSigning()
        return signer.url(key, 'GET', opts.expiresIn ?? DEFAULT_URL_EXPIRES_IN)
      },
      async remove(names) {
        const keys = names.map((name) => toFileKey(organizationId, name))
        for (const key of keys) {
          await rm(pathOf(key), { force: true })
          await rm(typePathOf(key), { force: true })
        }
      },
      async removePrefix(folder) {
        const prefix = toFolderPrefix(organizationId, folder)
        await rm(pathOf(prefix), { recursive: true, force: true })
        await rm(typePathOf(prefix), { recursive: true, force: true })
      },
      async list(folder) {
        const files = await walk(pathOf(toFolderPrefix(organizationId, folder)))
        const listed: StoredFile[] = []
        for (const file of files.sort()) {
          const info = await stat(file)
          listed.push({
            path: relative(orgDir, file).split(sep).join('/'),
            size: info.size,
            modifiedAt: info.mtime.toISOString(),
          })
        }
        return listed
      },
    }
  }

  return {
    kind: 'local',
    forOrganization,
    async probe() {
      await mkdir(root, { recursive: true })
      await access(root)
    },
    async close() {},
    ...(signer ? { serveSigned: (request: Request) => signer.serve(request, store) } : {}),
  }
}
