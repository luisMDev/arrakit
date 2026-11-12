import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

/** Ports of the servers Playwright boots; override with E2E_API_PORT / E2E_WEB_PORT to run side by side. */
export const API_PORT = Number(process.env.E2E_API_PORT ?? 5100)
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5200)
export const API_ORIGIN = `http://localhost:${API_PORT}`
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`

/** The local Supabase stack (`pnpm supabase:start`), which `pnpm dev` uses too. */
export const DATABASE_URL = 'postgresql://postgres.pooler-dev:postgres@127.0.0.1:54329/postgres'
export const MAILPIT_ORIGIN = 'http://127.0.0.1:54324'

const STACK_ENV = fileURLToPath(new URL('../../api/.env.stack', import.meta.url))

/** What `pnpm supabase:start` wrote for the API: Better Auth's signing key, where the stack answers and its keys. */
export function stackEnv(): Record<string, string> {
  if (!existsSync(STACK_ENV)) return {}
  return Object.fromEntries(
    Object.entries(parseEnv(readFileSync(STACK_ENV, 'utf8'))).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}
