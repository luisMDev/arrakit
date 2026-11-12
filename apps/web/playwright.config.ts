import { defineConfig, devices } from '@playwright/test'

import {
  API_ORIGIN,
  API_PORT,
  DATABASE_URL,
  MAILPIT_ORIGIN,
  WEB_ORIGIN,
  WEB_PORT,
  stackEnv,
} from './e2e/origins'

// End-to-end tests boot the API (Hono, fake Stripe) and the web dev server, then drive Chromium.
// The database, the inbox and the files bucket are the local Supabase stack's, which must be
// running (`pnpm test:e2e` starts it) and is shared with `pnpm dev`: tests make their own people
// and organizations, never assuming an empty database. Set E2E_API_PORT and E2E_WEB_PORT to run a
// second suite next to another one.

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @arrakit/api exec tsx src/main.ts',
      url: `${API_ORIGIN}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...stackEnv(),
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL,
        STRIPE_FAKE: '1',
        BETTER_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0000',
        BETTER_AUTH_URL: WEB_ORIGIN,
        WEB_URL: WEB_ORIGIN,
        MAILPIT_URL: MAILPIT_ORIGIN,
      },
    },
    {
      command: `pnpm exec vite dev --port ${WEB_PORT}`,
      url: WEB_ORIGIN,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { API_ORIGIN: API_ORIGIN },
    },
  ],
})
