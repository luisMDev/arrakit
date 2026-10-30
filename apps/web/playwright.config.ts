import { defineConfig, devices } from '@playwright/test'

// End-to-end tests boot the API (Hono, PGlite in a throwaway dir, fake Stripe,
// console/outbox mailer) and the web dev server, then drive Chromium.
const API_PORT = 3100
const WEB_PORT = 4200
const apiOrigin = `http://localhost:${API_PORT}`
const webOrigin = `http://localhost:${WEB_PORT}`

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
      command: 'pnpm --filter @arrakit/api exec tsx src/main.ts',
      url: `${apiOrigin}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        PGLITE_DIR: '.data/e2e-pglite',
        PGLITE_RESET: '1',
        STRIPE_FAKE: '1',
        BETTER_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0000',
        BETTER_AUTH_URL: webOrigin,
        WEB_URL: webOrigin,
      },
    },
    {
      command: `pnpm exec vite dev --port ${WEB_PORT}`,
      url: webOrigin,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { API_ORIGIN: apiOrigin },
    },
  ],
})
