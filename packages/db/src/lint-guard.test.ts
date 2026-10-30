import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const repo = fileURLToPath(new URL('../../../', import.meta.url))

const lint = async (file: string, code: string) => {
  const eslint = new ESLint({ cwd: repo })
  const [result] = await eslint.lintText(code, { filePath: `${repo}${file}` })
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message)
}

const DRIVERS = [
  "import pg from 'pg'",
  "import { PgBoss } from 'pg-boss'",
  "import { eq } from 'drizzle-orm'",
  "import { drizzle } from 'drizzle-orm/node-postgres'",
  "import { PGlite } from '@electric-sql/pglite'",
  "import { S3Client } from '@aws-sdk/client-s3'",
]

describe('the data import guard', () => {
  it.each(DRIVERS)('refuses %s in apps/api', async (code) => {
    const messages = await lint('apps/api/src/guard-probe.ts', `${code}\nexport {}\n`)
    expect(messages.length).toBeGreaterThan(0)
    for (const message of messages) {
      expect(message).toContain('Only @arrakit/db may import data drivers')
    }
  })

  it('allows the drivers inside packages/db', async () => {
    const code = `${DRIVERS.join('\n')}\nexport {}\n`
    expect(await lint('packages/db/src/guard-probe.ts', code)).toEqual([])
  })
}, 30_000)
