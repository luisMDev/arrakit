import { defineConfig, devices } from '@playwright/test'

import {
  API_ORIGIN as apiOrigin,
  API_PORT,
  MAILPIT_ORIGIN as mailpitOrigin,
  MAILPIT_PORT,
  WEB_ORIGIN as webOrigin,
  WEB_PORT,
} from './e2e/origins'

// End-to-end tests boot Mailpit, the API (Hono, PGlite in a throwaway dir, fake Stripe, mail to
// Mailpit) and the web dev server, then drive Chromium. Set E2E_API_PORT, E2E_WEB_PORT and
// E2E_MAILPIT_PORT to run a second suite next to another one; each set gets its own database.

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: webOrigin,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `../../scripts/mailpit.sh --listen localhost:${MAILPIT_PORT} --smtp localhost:${MAILPIT_PORT + 1}`,
      url: `${mailpitOrigin}/livez`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @arrakit/api exec tsx src/main.ts',
      url: `${apiOrigin}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        PGLITE_DIR: `.data/e2e-pglite-${API_PORT}`,
        PGLITE_RESET: '1',
        STRIPE_FAKE: '1',
        BETTER_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0000',
        BETTER_AUTH_URL: webOrigin,
        WEB_URL: webOrigin,
        MAILPIT_URL: mailpitOrigin,
      },
    },
    {
      command: `pnpm exec vite dev --port ${WEB_PORT}`,
      url: webOrigin,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { API_ORIGIN: apiOrigin, E2E: '1' },
    },
  ],
})
