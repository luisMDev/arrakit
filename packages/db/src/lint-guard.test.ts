import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const GUARD_RULES = ['no-restricted-imports', 'no-restricted-syntax']

// typescript-eslint cannot infer tsconfigRootDir once several workspace configs are loaded in one
// process, so each workspace gets an instance that names its own.
const instances = new Map<string, ESLint>()
const eslintFor = (file: string) => {
  const workspace = file.split('/').slice(0, 2).join('/')
  let eslint = instances.get(workspace)
  if (!eslint) {
    eslint = new ESLint({
      cwd: repo,
      overrideConfig: { languageOptions: { parserOptions: { tsconfigRootDir: repo + workspace } } },
    })
    instances.set(workspace, eslint)
  }
  return eslint
}

const lint = async (file: string, code: string) => {
  const [result] = await eslintFor(file).lintText(code, { filePath: `${repo}${file}` })
  return (result?.messages ?? [])
    .filter((message) => message.fatal || GUARD_RULES.includes(message.ruleId ?? ''))
    .map((message) => message.message)
}

const GUARD = /Only @arrakit\/db may import data drivers|Use @arrakit\/db \(openData\(\)/

const DRIVERS = [
  "import pg from 'pg'",
  "import { PgBoss } from 'pg-boss'",
  "import { eq } from 'drizzle-orm'",
  "import type { InferSelectModel } from 'drizzle-orm'",
  "import { drizzle } from 'drizzle-orm/node-postgres'",
  "import Client from 'pg/lib/client'",
  "import { PGlite } from '@electric-sql/pglite'",
  "import { S3Client } from '@aws-sdk/client-s3'",
  "import { x } from '@aws-sdk/lib-storage'",
  "export { Pool } from 'pg'",
  "import pg = require('pg')",
  "const pg = require('pg')",
  "require('drizzle-orm/node-postgres')",
  "await import('pg-boss')",
  'await import(`@aws-sdk/client-s3`)',
]

const DB_INTERNALS = [
  "import { users } from '@arrakit/db/schema'",
  "import { openTestData } from '@arrakit/db/testing'",
  "import x from '@arrakit/db/src/organization/tenant-db'",
  "await import('@arrakit/db/schema')",
  "require('@arrakit/db/testing')",
]

const ALLOWED = [
  "import { openData } from '@arrakit/db'",
  "import x from './pg'",
  "import x from './db/pg-boss'",
  "import x from 'pgvector'",
  "import x from 'pg-format'",
  "import x from 'drizzle-zod'",
  "import x from '@aws-sdkx/foo'",
  "import x from '@arrakit/database'",
  "const label = 'pg'",
  "console.log('drizzle-orm failed')",
]

const PRODUCTION_FILES = [
  'apps/api/src/guard-probe.ts',
  'apps/web/src/guard-probe.tsx',
  'packages/auth/src/guard-probe.ts',
  'packages/contract/src/guard-probe.ts',
]

describe('the data import guard', () => {
  it.each(PRODUCTION_FILES.flatMap((file) => DRIVERS.map((code) => [file, code])))(
    'refuses, in %s, %s',
    async (file, code) => {
      const messages = await lint(file, `${code}\nexport {}\n`)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatch(GUARD)
    },
  )

  it.each(PRODUCTION_FILES.flatMap((file) => DB_INTERNALS.map((code) => [file, code])))(
    'refuses @arrakit/db internals in production code: %s, %s',
    async (file, code) => {
      const messages = await lint(file, `${code}\nexport {}\n`)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatch(GUARD)
    },
  )

  it.each(ALLOWED)('lets %s through', async (code) => {
    expect(await lint('apps/api/src/guard-probe.ts', `${code}\nexport {}\n`)).toEqual([])
  })

  it('refuses the drivers in a .cjs file too', async () => {
    expect(await lint('apps/api/scripts/guard-probe.cjs', "require('pg')\n")).toHaveLength(1)
    expect(await lint('apps/api/scripts/guard-probe.mjs', "import pg from 'pg'\n")).toHaveLength(1)
  })

  it.each([
    'apps/api/src/routers/guard-probe.test.ts',
    'apps/api/src/testing/guard-probe.ts',
    'apps/api/src/billing/testing.ts',
    'packages/auth/src/guard-probe.test.ts',
    'apps/web/e2e/guard-probe.spec.ts',
  ])('lets test files and harnesses (%s) use the schema and test helpers', async (file) => {
    const code = `${DB_INTERNALS.slice(0, 2).join('\n')}\nexport {}\n`
    expect(await lint(file, code)).toEqual([])
  })

  it.each(DRIVERS)('still refuses %s in a test file', async (code) => {
    const messages = await lint('apps/api/src/routers/guard-probe.test.ts', `${code}\nexport {}\n`)
    expect(messages).toHaveLength(1)
  })

  it('allows the drivers inside packages/db', async () => {
    const code = `${DRIVERS.filter((line) => !line.includes('require') && !line.includes('await')).join('\n')}\nexport {}\n`
    expect(await lint('packages/db/src/guard-probe.ts', code)).toEqual([])
  })
}, 60_000)

const SUPABASE = [
  "import { createClient } from '@supabase/supabase-js'",
  "import type { SupabaseClient } from '@supabase/supabase-js'",
  "await import('@supabase/supabase-js')",
]

describe('the module guards', () => {
  it.each(
    [
      'apps/api/src/guard-probe.ts',
      'apps/web/src/components/guard-probe.tsx',
      'packages/auth/src/guard-probe.ts',
      'packages/contract/src/guard-probe.ts',
    ].flatMap((file) => SUPABASE.map((code) => [file, code])),
  )('refuse the Supabase client in %s: %s', async (file, code) => {
    const messages = await lint(file, `${code}\nexport {}\n`)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/Supabase client|joinChannel from '#\/lib\/realtime'/)
  })

  it.each([
    'apps/web/src/lib/realtime.ts',
    'packages/db/src/guard-probe.ts',
    'apps/web/e2e/guard-probe.ts',
  ])('let the Supabase client through in %s', async (file) => {
    expect(await lint(file, `${SUPABASE.join('\n')}\nexport {}\n`)).toEqual([])
  })

  it('keep each exception to its own module', async () => {
    const toast = "import { toast } from 'sonner'\nexport {}\n"
    expect(await lint('apps/web/src/lib/notify.ts', toast)).toEqual([])
    expect(await lint('apps/web/src/lib/realtime.ts', toast)).toEqual([
      "'sonner' import is restricted from being used. Show toasts with notify from '#/lib/notify'.",
    ])
    expect(await lint('apps/web/src/lib/notify.ts', `${SUPABASE[0]}\nexport {}\n`)).toHaveLength(1)
  })

  it('refuse @arrakit/db in web code and let the e2e suite use it', async () => {
    const code = "import { openData } from '@arrakit/db'\nexport {}\n"
    expect(await lint('apps/web/src/lib/guard-probe.ts', code)).toEqual([
      "'@arrakit/db' import is restricted from being used. The web never talks to the database; it only calls /api/*.",
    ])
    expect(await lint('apps/web/e2e/guard-probe.ts', code)).toEqual([])
  })
}, 60_000)
