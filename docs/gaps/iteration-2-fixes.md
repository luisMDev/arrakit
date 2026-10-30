# Iteration 2: fixes for the iteration-1 gaps

Each module fixed the gaps in the files it owns. The integrator then applied the shared-file edits
the modules asked for and ran every check.

## Fixed

### Auth and onboarding

- The web proxy rules now live in `apps/web/src/lib/api-proxy.ts`, and `apps/web/vite.config.ts`
  uses them in dev and in the production build (`.output/server/index.mjs` carries
  `xfwd: true, filterHeaders: ['x-forwarded-for']`). The API gets x-forwarded-for/-host/-proto
  with exactly one client IP. Any x-forwarded-for the client sends is dropped, because Better Auth
  without `trustedProxies` ignores a chain of more than one IP. `x-real-ip` passes through.
- `api-proxy.test.ts` runs h3's real route-rule runtime. `e2e/auth-proxy.spec.ts` checks that the
  session records the `x-real-ip` address end to end (spec auth-onboarding section 10).

### Organizations and members

- When `markEmailSent` fails after the email went out, invite and resend log the error and still
  answer 200, as saas-base does.
- If the account has no name, Settings > Account shows the part of the email before the @.
  Leaving the name field without typing saves nothing.
- If saving the browser time zone automatically fails, the error is reported and nothing else
  happens: no toast, no reload.
- Org deletion cascade tests check the migrated catalog (every `organization_id` is NOT NULL with
  ON DELETE CASCADE) and delete one seeded organization out of two.

### Billing and plans

- Plans counts an organization as paying only when it has a known cycle and a paid plan.
- Checkout and the plan switch show the API's own refusal message for 400/402/403/409/502/503.
- The webhook passes the payment to `usage.reverse(...)`, so a refund followed by a dispute of the
  same payment never takes back more than that top-up. The webhook logs only when something was
  taken back. A new test in `apps/api/src/usage/top-up.test.ts` covers this.

### Usage and credits

- `limit` is clamped at 0, so `usage.get` no longer fails output validation after a refund, a
  dispute or a negative adjustment.
- Reversals are capped per payment while the organization row is locked. Payment keys are
  URI-encoded in the ledger prefix, so two payments can never share a cap.
- Row-lock tests on PGlite check the emitted `for no key update` and `on conflict do nothing`.
  `turbo.json` now passes `TEST_DATABASE_URL` through to the tests.

### Platform

- The REST (OpenAPI) endpoints are served at the paths the document gives. The cron jobs catch
  up on missed runs (`missed: 'once'`, UTC). pg-boss is tested on PGlite. A migration test
  checks that migrations run between the advisory lock and unlock.
- The presigned URLs of the local and memory storage send `nosniff` and a sandbox CSP.
- `/api/dev/outbox` is opt-in (`DEV_OUTBOX=1`, on by default only under `NODE_ENV=test`, refused
  in production). Playwright and `apps/api/.env.example` set it explicitly.
- `@arrakit/db` exports `ScopedData`. `AppDeps.data`, `BaseContext.data` and every API service,
  worker and MCP signature now take `ScopedData`, so production API code cannot reach the raw
  `db` or `storage` handles. Only `services.ts`, which builds the deps from `openData()`, and the
  test harness still hold the full `Data`.

### Web shell and landing

- Router navigations run in view transitions (`defaultViewTransition: true` in
  `apps/web/src/router.tsx`). The header and the app bar keep their own transition names.
  `styles.css` shortens the transition animations under `prefers-reduced-motion`.
- The root `README.md` now documents the product. Its facts were checked against the code.

## Checks

- `./node_modules/.bin/turbo run typecheck lint test build --continue`: 30/30 tasks green after
  the fixes. API: 407 tests. db: the real-Postgres and S3 suites are skipped (see below).
- `prettier --check .`: clean.
- Playwright (`apps/web`, `npx playwright test`): 31/31 passed.

## Still open

| Gap                                                                                                                                                                                | Reason                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real-Postgres runs: usage row-lock races, concurrent grant-on-read, migration advisory-lock contention, the pg-boss node-postgres pool and reconnect, and the org-deletion cascade | Docker and Postgres are not available on this machine. These suites run when `DATABASE_URL` (or `TEST_DATABASE_URL` for the usage race suite) points at a throwaway Postgres. Everything else runs on PGlite with the real migrations.                                          |
| S3 presigned URL 403s against a real bucket                                                                                                                                        | No MinIO or R2. `s3.int.test.ts` runs when `S3_TEST_*` is set. The local and memory fallbacks are fully tested.                                                                                                                                                                 |
| `cf-connecting-ip` is not mapped to x-forwarded-for behind Cloudflare                                                                                                              | Nitro route rules can only set static headers. This needs a server middleware in apps/web, and it matters only for a Cloudflare deployment. The edge can set `x-real-ip` instead, which passes through.                                                                         |
| No e2e runs against the production web build                                                                                                                                       | Playwright runs `vite dev`. The production build was checked for the proxy rules, and they are covered by `api-proxy.test.ts` against h3's real runtime. Note that `API_ORIGIN` is read when the web app is built, so the built server proxies to the origin it was built with. |
| The e2e cannot tell the x-forwarded-for path from Better Auth's localhost fallback under `NODE_ENV=test`                                                                           | Better Auth falls back to 127.0.0.1 in test mode. The e2e asserts the `x-real-ip` path. The x-forwarded-for behaviour is covered at the unit level.                                                                                                                             |
| x-forwarded-host/-proto are not asserted directly in e2e                                                                                                                           | The API has no endpoint that echoes headers. Their visible effects are asserted: the web-origin issuer and resource.                                                                                                                                                            |
| The REST OpenAPI handler and `/api/files/local/*` are mounted from `routes/health.ts` and `routes/dev-outbox.ts`, not from `app.ts`                                                | An optional cleanup. Both routes work and are tested, and AGENTS.md documents the paths.                                                                                                                                                                                        |
