import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { main } from './init.ts'
import { readIdentity, runInit } from './init/run.ts'
import { deriveNames } from './init/rename.ts'

const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x61, 0x72, 0x72, 0x61, 0x6b, 0x69, 0x74])

const FILES: Record<string, string> = {
  'package.json': '{ "name": "arrakit", "description": "Arrakit: a SaaS base." }\n',
  'packages/db/package.json': '{ "name": "@arrakit/db" }\n',
  'packages/emails/src/index.ts': "export const APP_NAME = 'Arrakit'\n",
  'packages/auth/src/config.ts': "export const COOKIE_PREFIX = 'arrakit'\n",
  'apps/web/src/lib/auth-client.ts':
    "import { createArrakitAuthClient } from '@arrakit/auth/client'\n",
  'apps/web/src/notes.md': 'Nothing to rename here.\n',
  'scripts/init/fixture.ts': "export const SAMPLE = '@arrakit/db'\n",
  'supabase/config.toml': 'project_id = "arrakit"\n',
  '.gitignore': 'ignored.txt\n',
  'ignored.txt': 'arrakit\n',
  'untracked.txt': 'Arrakit\n',
}

let repo: string

const read = (path: string) => readFileSync(join(repo, path), 'utf8')

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'arrakit-init-'))
  for (const [path, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), content)
  }
  writeFileSync(join(repo, 'logo.png'), BINARY)
  execFileSync('git', ['init', '--quiet'], { cwd: repo })
  execFileSync(
    'git',
    ['add', '--', ...Object.keys(FILES).filter((p) => !p.endsWith('.txt')), 'logo.png'],
    {
      cwd: repo,
    },
  )
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('readIdentity', () => {
  it('reads the slug, scope and name the repository carries', () => {
    expect(readIdentity(repo)).toEqual(deriveNames({ name: 'Arrakit' }))
  })
})

describe('runInit', () => {
  const to = deriveNames({ name: 'Acme Cloud', scope: 'acme' })

  it('lists the changes of a dry run and writes nothing', () => {
    const changes = runInit({ cwd: repo, from: readIdentity(repo), to, dryRun: true })

    expect(changes).toEqual(
      expect.arrayContaining([
        { path: 'package.json', count: 2 },
        { path: 'apps/web/src/lib/auth-client.ts', count: 2 },
        { path: 'untracked.txt', count: 1 },
        { path: 'supabase/config.toml', count: 1 },
      ]),
    )
    expect(read('package.json')).toBe(FILES['package.json'])
  })

  it('rewrites tracked and untracked text files, leaving ignored, binary and its own files alone', () => {
    const changes = runInit({ cwd: repo, from: readIdentity(repo), to, dryRun: false })

    expect(changes.map((change) => change.path).sort()).toEqual([
      'apps/web/src/lib/auth-client.ts',
      'package.json',
      'packages/auth/src/config.ts',
      'packages/db/package.json',
      'packages/emails/src/index.ts',
      'supabase/config.toml',
      'untracked.txt',
    ])
    expect(read('package.json')).toBe(
      '{ "name": "acme-cloud", "description": "Acme Cloud: a SaaS base." }\n',
    )
    expect(read('apps/web/src/lib/auth-client.ts')).toBe(
      "import { createAcmeCloudAuthClient } from '@acme/auth/client'\n",
    )
    expect(read('packages/auth/src/config.ts')).toBe("export const COOKIE_PREFIX = 'acme-cloud'\n")
    expect(read('supabase/config.toml')).toBe('project_id = "acme-cloud"\n')
    expect(read('untracked.txt')).toBe('Acme Cloud\n')
    expect(read('ignored.txt')).toBe(FILES['ignored.txt'])
    expect(read('scripts/init/fixture.ts')).toBe(FILES['scripts/init/fixture.ts'])
    expect(readFileSync(join(repo, 'logo.png'))).toEqual(BINARY)
    expect(readIdentity(repo)).toEqual(to)
  })
})

describe('main', () => {
  const run = (...argv: string[]) => main(argv, repo)

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('requires --name outside a terminal', async () => {
    expect(await run()).toBe(1)
    expect(vi.mocked(console.error).mock.calls[0]?.[0]).toMatch(/--name is required/)
  })

  it('refuses an invalid slug and writes nothing', async () => {
    expect(await run('--name', 'Acme', '--slug', 'Acme_Cloud', '--yes')).toBe(1)
    expect(read('package.json')).toBe(FILES['package.json'])
  })

  it('renames the repository and can rename it again', async () => {
    expect(await run('--name', 'Acme Cloud', '--scope', 'acme', '--yes')).toBe(0)
    expect(await run('--name', 'Nimbus', '--yes')).toBe(0)

    expect(read('apps/web/src/lib/auth-client.ts')).toBe(
      "import { createNimbusAuthClient } from '@nimbus/auth/client'\n",
    )
    expect(read('supabase/config.toml')).toBe('project_id = "nimbus"\n')
    const logged = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(logged).toMatch(/nimbus_pro_monthly[\s\S]*nimbus\.session_token/)
    expect(logged).toMatch(/supabase stop --project-id acme-cloud/)
  })
})

describe('the repository itself', () => {
  const root = new URL('../', import.meta.url)

  it('names the local Supabase stack after the root package', () => {
    const config = readFileSync(new URL('supabase/config.toml', root), 'utf8')
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { name: string }

    expect(config.match(/^project_id = "([^"]+)"$/m)?.[1]).toBe(pkg.name)
  })
})
