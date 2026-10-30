# Iteration 4: fixes for the iteration-3 gaps

Each module fixed or checked the gaps in the files it owns. The integrator then applied the
shared-file edits the modules asked for and ran every check.

## Fixed

### Auth and onboarding

- `skipWhenSignedIn` (`apps/web/src/lib/guards/skip-when-signed-in.ts`) shows
  `onboarding.unreachable` only when there was no answer (a network `TypeError`, also found
  through the `Error.cause` chain) or the status is 500 or higher. Every other error shows
  `onboarding.failed` and logs `[skipWhenSignedIn] the guard failed`. A 401 shows nothing and
  logs nothing. A preload shows no toast. This matches saas-base `isUnreachable()` and spec rule 4.
- `onboarding-guards.test.ts` runs the real `session()` and oRPC client over a stubbed `fetch`:
  a plain `Error`, a non-JSON session body, a bug `TypeError` and a `TypeError` naming
  `fetchQuery` each show the failed toast. These are the saas-base cases. A 502 HTML page on
  `me.get` shows the unreachable toast.

### Organizations and members

- An inviter whose name is blank is named by the local part of their email in the invite
  subject (`members.test.ts`, through the real `invitations.invite`). Removing the trim or the
  fallback in `packages/auth/src/magic-link.ts` fails the test.
- `packages/db/src/organization/tenant-db-locking.test.ts` checks that `lock()` sends
  `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE` and `FOR KEY SHARE`, filtered by the
  organization, by logging the SQL PGlite runs.

### Billing and plans

- Settings > Billing and Plans show the API's refusal message (`refusalMessage(err)`) for 400/403
  when `billing.get`, cancel, resume, the portal or `previewChange` fail, and the fixed text
  otherwise. `plans.list` keeps its fixed text and the plan switch keeps `paymentRefusal`.
  `billingRefusal` is removed. The refusal tests also check that the fixed text is absent.
- Toasts no longer leak between component tests: `toast.dismiss()` runs in `afterEach`.

### Usage and credits

- A `usage.get` failure in Settings > Billing shows "Couldn't load usage. Reload the page." and
  billing still renders (`billing-usage.test.tsx`, through the real `BillingSection`).
  The Pro top-up case checks every card line against saas-base. The 5/501/empty amount bounds run
  through the Billing page.
- `apps/web/e2e/usage-billing.spec.ts`: an admin is refused at $5, previews $45, reaches the
  fake Checkout, and the webhook credits the top-up. A member sees Settings > Usage with no
  buttons.

### Platform

- `apps/api/.env.example`: operator notes checked against the code. No change needed.
- The production web proxy now runs as a Nitro handler (`apps/web/src/server/api-proxy-handler.ts`,
  registered in `apps/web/vite.config.ts` for each of `apiProxiedPaths`). It reads `API_ORIGIN`
  on every request, so one build can point at any API. It maps `cf-connecting-ip` to the single
  `x-forwarded-for` the API sees (else the TCP peer). `api-proxy-handler.test.ts` has 11 cases.
  The integrator also smoke-tested the production build (`.output/server/index.mjs`) with
  `API_ORIGIN` set only at run time: the request reached the fake API with
  `x-forwarded-for: 9.9.9.9` from `cf-connecting-ip`.

## Integrator changes

- Applied every requested shared-file edit: the new `apps/web/src/server/api-proxy-handler.ts`
  and its test, a new `apps/web/vite.config.ts`, the comments in `e2e/auth-proxy.spec.ts` and
  `e2e/oauth-proxy.spec.ts`, `apps/web/.env.example`, and the AGENTS.md proxy section.
- `apps/web/src/lib/api-proxy.ts`: `apiProxyRules` and `ApiProxyRule` are removed. Their tests
  in `api-proxy.test.ts` are replaced by the cases for `apiProxiedPaths` and `apiOriginFrom`.
  The proxy behaviour is tested in `src/server/api-proxy-handler.test.ts`.
- `apps/web/src/components/settings/billing-section.tsx` passes `redirect` to `<BillingUsage>`.
  `billing-usage.test.tsx` now checks the Checkout URL the admin is sent to, and the test
  fails without the change.
- E2E stability: a client that aborts a request while its body is still uploading makes Nitro's
  dev middleware report `Internal server error: aborted`, and Vite's error overlay then covers
  the page and blocks clicks. It caused one random failure per full run (seen in
  `smoke.spec.ts` and `shell-signed-in.spec.ts`). A standalone probe reproduced it with the old
  route rules too, so it predates the new handler, and the handler never sees the error. The fix:
  Playwright starts the dev server with `E2E=1`, and `vite.config.ts` turns the overlay off when
  `E2E=1`. Two full runs after the fix were green.
- `docs/ownership.md`: platform owns `apps/web/src/server/`. `tenant-db-locking.test.ts` belongs
  to platform under the "tests live next to the code" rule. AGENTS.md documents `E2E=1`.

## Checks

- `pnpm turbo run typecheck lint test build --continue`: 30/30 tasks green. API: 29 files.
  Web: 39 files. DB: 25 files pass and 1 is skipped (the Postgres-only locking suite).
- `prettier --check .`: clean.
- Playwright (`apps/web`, ports 3100/4200): 35/35 passed, twice.

## Still open

- **`lock()` waiting under real Postgres** (saas-base `tenant-db.int.spec.ts:196`): PGlite has
  one connection and runs transactions one after another, so it cannot show one transaction
  waiting for another. The port exists in `tenant-db-locking.test.ts` behind
  `describe.skipIf(!TEST_DATABASE_URL && !DATABASE_URL)`, but it has never run because there is
  no Postgres or Docker here. The lock clause itself is covered by the SQL checks.
- **`cf-connecting-ip` is trusted whenever it is present**: saas-base makes the same choice. If
  the web server can be reached without Cloudflare in front, a client can choose the IP recorded
  for its session and used as its rate-limit key. `x-real-ip` already worked this way, so this
  adds no new kind of exposure.
- **Nitro dev reports a mid-upload client abort as a server error**: this is upstream
  behaviour, and it happens only in dev. E2E hides it by turning the overlay off, and production
  builds are not affected.
- Items carried over from iteration 3 with no change: `createOrganization` outside
  `transactionWithJobs`, `fillZone` outside the save queue, `transactionWithJobs` and bucket
  CORS never run against real Postgres or R2, and error statuses kept in an apps/api table. See
  `iteration-3-fixes.md` for the reasons.
