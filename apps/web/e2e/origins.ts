/** Ports of the servers Playwright boots; override with E2E_API_PORT / E2E_WEB_PORT to run side by side. */
export const API_PORT = Number(process.env.E2E_API_PORT ?? 3100)
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4200)
export const API_ORIGIN = `http://localhost:${API_PORT}`
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`
