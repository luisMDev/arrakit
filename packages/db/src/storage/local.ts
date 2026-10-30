import { access, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

import { FileNotFoundError } from '../errors'
import { toFileKey, toFolderPrefix } from './file-key'
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

export function localStorage(root: string): Storage {
  const pathOf = (key: string) => join(root, ...key.split('/'))

  const forOrganization = (organizationId: string): OrganizationFiles => {
    const orgDir = pathOf(toFolderPrefix(organizationId, '').slice(0, -1))
    return {
      async putUrl() {
        throw new Error('[data] local storage does not presign URLs')
      },
      async put(name, bytes) {
        const path = pathOf(toFileKey(organizationId, name))
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, bytes)
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
        try {
          await copyFile(pathOf(toFileKey(organizationId, from)), target)
        } catch (err) {
          if (isMissing(err)) throw new FileNotFoundError(from)
          throw err
        }
      },
      async getUrl() {
        throw new Error('[data] local storage does not presign URLs')
      },
      async remove(names) {
        const paths = names.map((name) => pathOf(toFileKey(organizationId, name)))
        for (const path of paths) await rm(path, { force: true })
      },
      async removePrefix(folder) {
        await rm(pathOf(toFolderPrefix(organizationId, folder)), { recursive: true, force: true })
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
  }
}
