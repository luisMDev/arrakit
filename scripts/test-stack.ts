import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'

import { checkAdvisors } from './db-advisors.ts'
import { STACK_ENV_FILE } from './supabase-keys.ts'

/** The local stack's transaction pooler, as apps/api/.env.example and the e2e suite name it. */
export const STACK_DATABASE_URL =
  'postgresql://postgres.pooler-dev:postgres@127.0.0.1:54329/postgres'

export const SKIPPED =
  'test:stack skipped: the local Supabase stack is not running. Start it with `pnpm supabase:start`.'

const STACK_FILE_VARIABLES = [
  'BETTER_AUTH_JWT_KEY',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
] as const

/** What the stack suite needs: the keys `pnpm supabase:start` wrote, and the pooler. */
export function stackSuiteEnv(cwd: string): Record<string, string> {
  const file = join(cwd, STACK_ENV_FILE)
  const values = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}
  const missing = STACK_FILE_VARIABLES.filter((name) => !values[name])
  if (missing.length > 0)
    throw new Error(`${STACK_ENV_FILE} lacks ${missing.join(', ')}: run \`pnpm supabase:start\``)
  return {
    ...Object.fromEntries(STACK_FILE_VARIABLES.map((name) => [name, values[name]!])),
    DATABASE_URL: STACK_DATABASE_URL,
  }
}

export interface StackRun {
  running(): boolean
  suite(env: Record<string, string>): boolean
  advisors(): boolean
  log(line: string): void
}

/** Runs the stack suite and the advisors when the stack is up; the exit code to report. */
export function runStackSuite(cwd: string, run: StackRun): number {
  if (!run.running()) {
    run.log(SKIPPED)
    return 0
  }
  let env: Record<string, string>
  try {
    env = stackSuiteEnv(cwd)
  } catch (err) {
    run.log((err as Error).message)
    return 1
  }
  const suite = run.suite(env)
  const advisors = run.advisors()
  return suite && advisors ? 0 : 1
}

function succeeds(work: () => unknown): boolean {
  try {
    work()
    return true
  } catch {
    return false
  }
}

const realRun: StackRun = {
  running: () =>
    succeeds(() =>
      execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { stdio: 'ignore' }),
    ),
  suite: (env) =>
    succeeds(() =>
      execFileSync(
        'pnpm',
        ['exec', 'turbo', 'run', 'test:stack', '--concurrency=1', '--continue'],
        {
          stdio: 'inherit',
          env: { ...process.env, ...env },
        },
      ),
    ),
  advisors: () => {
    try {
      return checkAdvisors()
    } catch (err) {
      console.error((err as Error).message)
      return false
    }
  },
  log: (line) => console.log(line),
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = runStackSuite(process.cwd(), realRun)
}
