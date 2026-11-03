/** Ports of the servers Playwright boots; override with E2E_API_PORT / E2E_WEB_PORT / E2E_MAILPIT_PORT / E2E_RUSTFS_PORT to run side by side. */
export const API_PORT = Number(process.env.E2E_API_PORT ?? 5100)
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5200)
export const MAILPIT_PORT = Number(process.env.E2E_MAILPIT_PORT ?? 5125)
export const RUSTFS_PORT = Number(process.env.E2E_RUSTFS_PORT ?? 5130)
export const API_ORIGIN = `http://localhost:${API_PORT}`
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`
export const MAILPIT_ORIGIN = `http://localhost:${MAILPIT_PORT}`
export const RUSTFS_ORIGIN = `http://127.0.0.1:${RUSTFS_PORT}`
