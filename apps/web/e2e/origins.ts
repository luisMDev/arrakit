/** Ports of the servers Playwright boots; override with E2E_API_PORT / E2E_WEB_PORT / E2E_RUSTFS_PORT to run side by side. */
export const API_PORT = Number(process.env.E2E_API_PORT ?? 5100)
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5200)
export const RUSTFS_PORT = Number(process.env.E2E_RUSTFS_PORT ?? 5130)
export const API_ORIGIN = `http://localhost:${API_PORT}`
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`
export const RUSTFS_ORIGIN = `http://127.0.0.1:${RUSTFS_PORT}`

/** The local Supabase stack (`pnpm supabase:start`), which `pnpm dev` uses too. */
export const DATABASE_URL = 'postgresql://postgres.pooler-dev:postgres@127.0.0.1:54329/postgres'
export const DATABASE_DIRECT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
export const MAILPIT_ORIGIN = 'http://127.0.0.1:54324'
