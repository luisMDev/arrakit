# Iteration 3: fixes for the iteration-2 gaps

Each module fixed or checked the gaps in the files it owns. The integrator then applied the
shared-file edits the modules asked for and ran every check.

## Fixed

### Auth and onboarding

- Social sign-in is reflected in Settings > Account. `apps/api/src/routes/auth.test.ts` runs the
  real Better Auth social flow over HTTP, with only the provider's token endpoint mocked. It checks
  that a Microsoft sign-in shows through the original magic-link session
  (`signInWith: 'microsoft'`), and that a first Microsoft sign-in shows the name, email and
  provider, as it already did for Google.
- Legacy `/start` and `/new` keep the whole query string (utm\_\*, ref) when they redirect to
  `/signup`. `legacy-entry-points.test.tsx` checks this against the real route tree with an
  exact match, and the e2e spec checks the final URL.

### Organizations and members

- Settings > Account saves changes one at a time, in order. After a failed save, the changes
  queued behind it are dropped and the section reloads the server values with the `notSaved`
  toast. Each choice is written to the cache optimistically, and only the latest save writes its
  response. The account query no longer refetches on window focus or reconnect, so a background
  refetch cannot put back an old value between queued saves.
- After Sign out everywhere, the account reloads. If that reload fails, the `devicesNotLoaded`
  toast shows and the devices already on screen stay.
- Settings > General loads the organization fresh when the section opens (`notLoaded` toast on
  failure) and reloads after a failed rename (`notSaved`).

### Usage and credits

- `apps/api/src/usage/usage-http.test.ts` checks the 402 Payment Required response over real HTTP
  through the OpenAPI and RPC handlers: credits and storage limits, the serialized
  `{metric, requested, available}` data, the message, 401 when signed out, and that nothing is
  consumed after a refusal.

### Platform

- OpenAPI lists the statuses of each operation (`apps/api/src/routes/openapi.ts`,
  `OPERATION_STATUSES`). Void DELETEs answer 204 with no body on the REST surface. `/health`
  documents 200 and 503. `/api/openapi.json` and `openapi:export` now serve this document:
  `app.ts` re-exports `generateOpenApiDocument` as `openApiDocument`, and the hand-written
  /health patch is gone. `openapi.test.ts` sweeps every operation as a signed-out caller, as a
  person with no organization, and as the owner of a Free organization, and checks that every
  status it gets back is documented.
- Jobs can be sent inside a transaction: `data.transactionWithJobs`. pg-boss writes the job through
  the transaction's own connection. The in-process and memory runners hold the job until the
  transaction commits. `jobConnectionOf` and `transactionWithJobs` are exported from `@arrakit/db`.
- Bucket CORS: `packages/db/src/storage/r2-cors.json` (the same as saas-base), `r2CorsPolicy`,
  `s3CorsRules` and `putBucketCors`, all exported from `@arrakit/db`. The new
  `pnpm --filter @arrakit/api bucket:cors [--print]` (`apps/api/scripts/bucket-cors.ts`, tested)
  applies the policy for the web origin or prints it. `apps/api/.env.example` documents this next
  to the R2 variables.

### Web shell

- The account language wins over a remembered or browser language that is still loading.
  `requireUser` always loads `me.language`, and the root `beforeLoad` waits until the initial
  language switch has finished. Tests cover both, and fail when the change is reverted.

### Billing and plans

- No open gaps.

## Integrator changes

- `apps/api/src/app.ts`: serves `generateOpenApiDocument()`. The old generator and its imports are
  removed.
- `packages/db/src/index.ts`: exports the transaction-with-jobs and bucket CORS helpers.
- `apps/api/scripts/bucket-cors.ts` (+ test) and the `bucket:cors` script in
  `apps/api/package.json`.
- `apps/api/.env.example`: a note on bucket CORS.
- `docs/ownership.md`: platform owns `apps/api/src/routes/openapi.ts` and
  `apps/api/scripts/bucket-cors.ts`. `AGENTS.md`: the new command, and where the OpenAPI document
  comes from.

## Checks

- `pnpm turbo run typecheck lint test build --continue`: 30/30 tasks green. API: 29 files, 432
  tests. Web: 37 files, 428 tests.
- `prettier --check .`: clean.
- Playwright (`apps/web`, ports 3100/4200): 33/33 passed.

## Still open

- **createOrganization inside `transactionWithJobs`** (optional): not done. saas-base runs it
  inside its transactionWithJobs, but it never sends a job there. Wrapping it would change nothing
  until onboarding has a job to send.
- **fillZone outside the save queue** (Settings > Account): saving the browser time zone for a
  new account calls `me.account.update` outside `saveOnChange`. In theory it can run at the same
  time as a change the person makes right after the section opens. The impact is low: it writes
  the cache only when nothing has been queued, and a later change still saves after it.
  saas-base fills the zone in its API, so there is no exact counterpart to copy.
- **`transactionWithJobs` on real Postgres**: the node-postgres suite runs only when
  `DATABASE_URL` is set, and there is no Postgres or Docker here. The same code path is covered
  with pg-boss on PGlite.
- **Bucket CORS against a real R2/S3 bucket**: there are no credentials here. The S3 call is
  covered with a mocked client.
- **Error statuses live in an apps/api table, not as `.errors()` in each contract file**: the
  contract files belong to other modules. A test catches a procedure added without a table entry.
  A router that starts throwing a new status is caught only if one of the three sweeps reaches it.
