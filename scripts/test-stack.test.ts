import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STACK_ENV_FILE } from './supabase-keys.ts'
import { SKIPPED, STACK_DATABASE_URL, type StackRun, runStackSuite } from './test-stack.ts'

const root = new URL('../', import.meta.url)

const stackFile = {
  BETTER_AUTH_JWT_KEY: '{"kty":"EC"}',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
}

let repo: string

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'test-stack-'))
  mkdirSync(join(repo, 'apps', 'api'), { recursive: true })
})
afterEach(() => rmSync(repo, { recursive: true, force: true }))

function writeStackFile(values: Record<string, string>) {
  const lines = Object.entries(values).map(([name, value]) => `${name}='${value}'`)
  writeFileSync(join(repo, STACK_ENV_FILE), `${lines.join('\n')}\n`)
}

function fakeRun(answers: Partial<Pick<StackRun, 'running' | 'suite' | 'advisors'>> = {}) {
  const lines: string[] = []
  const run = {
    running: vi.fn(answers.running ?? (() => true)),
    suite: vi.fn(answers.suite ?? (() => true)),
    advisors: vi.fn(answers.advisors ?? (() => true)),
    log: (line: string) => lines.push(line),
  }
  return { run, lines }
}

describe('runStackSuite', () => {
  it('skips with a message when the stack is not running', () => {
    const { run, lines } = fakeRun({ running: () => false })
    expect(runStackSuite(repo, run)).toBe(0)
    expect(lines).toEqual([SKIPPED])
    expect(SKIPPED).toBe(
      'test:stack skipped: the local Supabase stack is not running. Start it with `pnpm supabase:start`.',
    )
    expect(run.suite).not.toHaveBeenCalled()
    expect(run.advisors).not.toHaveBeenCalled()
  })

  it('fails, naming what is missing, when the stack env file is incomplete', () => {
    const { SUPABASE_SECRET_KEY: _secret, ...rest } = stackFile
    writeStackFile(rest)
    const { run, lines } = fakeRun()
    expect(runStackSuite(repo, run)).toBe(1)
    expect(lines).toEqual([
      'apps/api/.env.stack lacks SUPABASE_SECRET_KEY: run `pnpm supabase:start`',
    ])
    expect(run.suite).not.toHaveBeenCalled()
  })

  it('fails when there is no stack env file at all', () => {
    const { run, lines } = fakeRun()
    expect(runStackSuite(repo, run)).toBe(1)
    expect(lines[0]).toMatch(/lacks BETTER_AUTH_JWT_KEY, .*SUPABASE_SECRET_KEY/)
  })

  it('hands the suite the stack keys and the pooler, then runs the advisors', () => {
    writeStackFile({ ...stackFile, OTHER: 'ignored' })
    const { run } = fakeRun()
    expect(runStackSuite(repo, run)).toBe(0)
    expect(run.suite).toHaveBeenCalledWith({ ...stackFile, DATABASE_URL: STACK_DATABASE_URL })
    expect(run.advisors).toHaveBeenCalledOnce()
  })

  it('runs the advisors after a failing suite, and fails', () => {
    writeStackFile(stackFile)
    const { run } = fakeRun({ suite: () => false })
    expect(runStackSuite(repo, run)).toBe(1)
    expect(run.advisors).toHaveBeenCalledOnce()
  })

  it('fails when the advisors report something', () => {
    writeStackFile(stackFile)
    const { run } = fakeRun({ advisors: () => false })
    expect(runStackSuite(repo, run)).toBe(1)
  })
})

describe('STACK_DATABASE_URL', () => {
  it('is the DATABASE_URL of apps/api/.env.example', () => {
    const example = parseEnv(readFileSync(new URL('apps/api/.env.example', root), 'utf8'))
    expect(STACK_DATABASE_URL).toBe(example.DATABASE_URL)
  })

  it('points at the pooler port of supabase/config.toml', () => {
    const config = readFileSync(new URL('supabase/config.toml', root), 'utf8')
    const pooler = config.slice(config.indexOf('[db.pooler]'))
    const port = /^port = (\d+)$/m.exec(pooler)?.[1]
    expect(port).toBeDefined()
    expect(new URL(STACK_DATABASE_URL).port).toBe(port)
  })
})
