import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { deriveNames, rename, type Identity } from './rename.ts'

const OWN_FILES = /^scripts\/init(\/|\.ts$|\.test\.ts$)/

export interface FileChange {
  path: string
  count: number
}

function readJsonName(path: string): string {
  const name: unknown = JSON.parse(readFileSync(path, 'utf8')).name
  if (typeof name !== 'string') throw new Error(`${path} has no "name"`)
  return name
}

/** Reads the identity the repository carries now, so a renamed repo can be renamed again. */
export function readIdentity(cwd: string): Identity {
  const slug = readJsonName(join(cwd, 'package.json'))
  const scope = /^@([^/]+)\//.exec(readJsonName(join(cwd, 'packages/db/package.json')))?.[1]
  if (!scope) throw new Error('packages/db/package.json is not a scoped package')
  const emails = readFileSync(join(cwd, 'packages/emails/src/index.ts'), 'utf8')
  const name = /export const APP_NAME = '([^']+)'/.exec(emails)?.[1]
  if (!name) throw new Error('APP_NAME not found in packages/emails/src/index.ts')
  return deriveNames({ name, slug, scope })
}

function repositoryFiles(cwd: string): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd, encoding: 'utf8' },
  )
  return output.split('\0').filter((path) => path && !OWN_FILES.test(path))
}

export function runInit({
  cwd,
  from,
  to,
  dryRun,
}: {
  cwd: string
  from: Identity
  to: Identity
  dryRun: boolean
}): FileChange[] {
  const changes: FileChange[] = []
  for (const path of repositoryFiles(cwd)) {
    const file = join(cwd, path)
    if (!existsSync(file)) continue
    const content = readFileSync(file)
    if (content.includes(0)) continue
    const result = rename(content.toString('utf8'), from, to)
    if (result.count === 0) continue
    if (!dryRun) writeFileSync(file, result.text)
    changes.push({ path, count: result.count })
  }
  return changes
}
