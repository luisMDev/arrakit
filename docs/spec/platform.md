# Platform spec (arrakit)

Area: **platform**. Everything under the product features: the data layer
(full Postgres schema, migrations, tenancy, jobs, file storage, test helpers),
API bootstrap and env config, health check, mailer and the account email
templates, storage purge worker, the MCP server with OAuth 2.1
(better-auth OAuth provider + `whoami`), the web's OAuth sign-in and consent
screens, and the `/.well-known` discovery routes.

Source of truth in saas-base (NestJS + Angular + Nx) that this file replaces:
`libs/platform/data`, `apps/api/src/{main.ts,app/app.module.ts,app/data,app/purge,app/health,app/mail,app/mcp,app/openapi}`,
`apps/api/src/app/auth/{auth.ts,auth.config.ts,auth.service.ts}` (the OAuth
provider parts), `apps/api/.env.example`, `libs/shared/emails`,
`apps/web/src/app/oauth`, `apps/web/functions/.well-known`,
`apps/web/src/edge/api-proxy.ts`, `apps/web/proxy.conf.json`.

Other areas (organizations, members/invitations, account settings, billing,
usage/credits, sign-in screens) have their own spec files. This file defines
the whole DB schema because every area builds on it, and names the data-layer
functions those areas call, but their HTTP endpoints and screens are specified
elsewhere.

---

## 1. Arrakit mapping (stack decisions for this area)

| saas-base | arrakit |
| --- | --- |
| `libs/platform/data` (`@saas/data`) | `packages/db` (or the name AGENTS.md uses): Drizzle schema, migrations, `openData()`, `forOrganization()`, jobs, storage, testing helpers |
| `node-postgres` + migrations on boot | `drizzle-orm/node-postgres` when `DATABASE_URL` is set; **`drizzle-orm/pglite`** (file dir) when it is not. Migrations applied on boot in both cases |
| pg-boss on the same Postgres | pg-boss when on real Postgres; **in-process job runner** with the same `Jobs` interface on PGlite |
| S3/R2 via `@aws-sdk/client-s3` | Same when `R2_*` env is set; **in-memory** `OrganizationFiles` otherwise |
| testcontainers Postgres + MinIO for `*.int.spec.ts` | **PGlite in-memory** per test file (Docker is not available) + in-memory storage. S3-specific behaviour is covered by unit tests with a mocked `S3Client` (optional) |
| NestJS controllers + nestjs-zod + `/api/openapi.json` | Hono app; oRPC contract (`@orpc/contract`) + Zod, served only over the oRPC protocol at `/api/rpc/*` (no REST routes, no OpenAPI document) |
| Nest middleware for `/api/auth/*`, `/api/mcp`, `/.well-known/*` | Plain Hono routes (`app.on(['GET','POST'], '/api/auth/*', c => auth.handler(c.req.raw))`, etc.) |
| `libs/shared/emails` | `packages/emails` (pure TS, no framework) |
| Angular `/oauth/signin`, `/oauth/consent` | TanStack Start routes `apps/web/src/routes/oauth/signin.tsx`, `oauth/consent.tsx` built with shadcn/ui (Card, Button, Input, Alert) |
| Angular dev proxy (`proxy.conf.json`) + Cloudflare Pages Functions | Vite dev server proxy in `apps/web` for `/api` and `/.well-known/oauth-*` to the API |
| `@modelcontextprotocol/server` 2.0 | Latest stable official MCP TypeScript SDK (`@modelcontextprotocol/sdk` or `@modelcontextprotocol/server`, whichever is current), stateless Streamable HTTP over a web `Request`/`Response` (fits Hono natively) |

Hard rules kept from saas-base:

- Every table except the named exceptions (section 2.10) has
  `organization_id uuid not null references organizations(id) on delete cascade`.
- The API never imports `pg`, `pg-boss`, `drizzle-orm`, `@electric-sql/pglite`
  or `@aws-sdk/*` directly: it goes through the db package's `openData()` /
  `forOrganization(id)`. Enforce with an ESLint `no-restricted-imports` rule
  (or Biome equivalent) scoped to `apps/api/**` and every package except the db
  package. A test (`lint-guard.spec.ts`) asserts the rule (worth porting, see
  section 12).
- Product name constant `APP_NAME` (saas-base: `'SaaS'`; arrakit: `'Arrakit'`)
  lives in one place in the emails package and one place in the web app.

---

## 2. Database schema (complete)

All timestamps are `timestamp with time zone`. `createdAt` / `updatedAt`
helpers: `created_at ... not null default now()`, `updated_at ... not null
default now()` with Drizzle `$onUpdate(() => new Date())`. Ids of better-auth
tables are `text` (better-auth generates them). Organization ids are `uuid`
(`gen_random_uuid()`). better-auth generates every id with
`advanced.database.generateId: () => randomUUID()`. Drizzle property names are
better-auth field names (camelCase); columns are snake_case. better-auth
Drizzle adapter is configured with `usePlural: true` and the schema map shown
in section 2.11. Organizations, members, invitations, teams, team members and
custom roles belong to the better-auth organization plugin (organizations spec).

Migrations: generated with `drizzle-kit generate` from `schema/index.ts` into
`packages/db/drizzle`. A committed migration is never edited. `0000_init`
creates everything; `0001` dropped `sessions.active_organization_id`; `0002`
adds the organization plugin's session columns, `invitations.team_id`, `teams`,
`team_members` and `organization_roles`.

### 2.1 `users` (better-auth `user`)

| column | type | constraints |
| --- | --- | --- |
| id | text | PK |
| name | text | not null |
| email | text | not null, unique (`users_email_unique`) |
| email_verified | boolean | not null default false |
| image | text | null |
| language | text | not null default `'en'`; check `language in ('en','es')` (`users_language_check`) |
| time_zone | text | null (IANA zone; stays null until the web sends the browser zone) |
| email_product_news | boolean | not null default false ("Product news" toggle; stored only, nothing sends it) |
| created_at, updated_at | timestamptz | defaults |

`ACCOUNT_LANGUAGES = ['en','es']`. better-auth `user.additionalFields`:
`language: { type: ['en','es'], defaultValue: 'en', input: false }` so the
session carries `user.language` and better-auth's own routes cannot change it.

### 2.2 `sessions`

| column | type | constraints |
| --- | --- | --- |
| id | text | PK |
| expires_at | timestamptz | not null |
| token | text | not null unique |
| created_at, updated_at | timestamptz | defaults |
| ip_address | text | null |
| user_agent | text | null |
| user_id | text | not null → users.id on delete cascade; index `sessions_user_id_idx` |
| active_organization_id | uuid | null → organizations.id on delete set null |
| active_team_id | text | null → teams.id on delete set null |

A new session starts in the earliest organization joined. The API reads the
membership in it fresh on every call (`activeMembership`), falling back to the
earliest one when it is unset or no longer the person's.

### 2.3 `accounts`

id text PK; account_id text not null; provider_id text not null; user_id text
not null → users.id cascade (index `accounts_user_id_idx`); access_token,
refresh_token, id_token text null; access_token_expires_at,
refresh_token_expires_at timestamptz null; scope text null; password text null;
created_at, updated_at.

`provider_id` values seen: `magic-link`, `google`, `microsoft`.

### 2.4 `verifications`

id text PK; identifier text not null (index `verifications_identifier_idx`);
value text not null; expires_at timestamptz not null; created_at, updated_at.
Magic link tokens are stored **hashed** (`storeToken: 'hashed'`) and deleted on
use.

### 2.5 `organizations` (tenant root)

| column | type | constraints |
| --- | --- | --- |
| id | uuid | PK default gen_random_uuid() |
| name | text | not null |
| slug | text | not null unique (lowercase) |
| logo | text | null (refused on update) |
| metadata | text | null (refused on update) |
| plan | text | not null default `'free'`; check `plan in ('free','pro','team','internal')`; declared to better-auth `input: false` |
| stripe_customer_id | text | null, unique |
| stripe_subscription_id | text | null |
| usage_anchor | timestamptz | null (billing anchor on a paid plan; months count from `created_at` on Free) |
| created_at | timestamptz | not null default now() |

The Stripe and usage columns are not declared to better-auth, so it never
returns or writes them.

### 2.6 `members`

| column | type | constraints |
| --- | --- | --- |
| id | text | PK, Drizzle `$defaultFn(() => randomUUID())` |
| organization_id | uuid | not null → organizations.id cascade |
| user_id | text | not null → users.id cascade; index `members_user_id_idx` |
| role | text | not null default `'member'` (better-auth role string: `owner` / `admin` / `member` / custom, `a,b` for several) |
| terms_accepted_at | timestamptz | null; declared `input: false` (stamped with DB `now()` by `onboarding.create`) |
| created_at | timestamptz | not null default now() |

Unique `(organization_id, user_id)` (`members_organization_id_user_id_unique`).

### 2.7 `invitations`

| column | type | constraints |
| --- | --- | --- |
| id | text | PK, `$defaultFn(() => randomUUID())` |
| organization_id | uuid | not null → organizations.id cascade; index `invitations_organization_id_idx` |
| email | text | not null (normalized); index `invitations_email_idx` |
| role | text | null (role string; never `owner`) |
| team_id | text | null (plugin; comma-separated team ids, no FK) |
| status | text | not null default `'pending'` (`pending` / `accepted` / `canceled` / `rejected`) |
| email_sent | boolean | not null default false (declared `input: false`; true once an invite email went out) |
| expires_at | timestamptz | not null |
| created_at | timestamptz | not null default now() |
| inviter_id | text | not null → users.id cascade |

Note: every non-better-auth column on a better-auth table must have a default
(better-auth refuses requests when a declared table has a required column it
never writes).

### 2.7.1 `teams`, `team_members`, `organization_roles` (organization plugin)

- `teams`: id text PK; name text not null; organization_id uuid not null →
  organizations.id cascade (index); member_count integer not null default 0;
  created_at; updated_at timestamptz null.
- `team_members`: id text PK; team_id text not null → teams.id cascade (index);
  user_id text not null → users.id cascade (index); membership_key text unique
  null; created_at timestamptz null.
- `organization_roles` (custom roles): id text PK; organization_id uuid not null
  → organizations.id cascade; role text not null; permission text not null
  (JSON statements); created_at not null default now(); updated_at null;
  unique `(organization_id, role)`.

### 2.8 Usage tables

`credit_ledger` (append-only; rows are never updated/deleted except by org
cascade):

| column | type | constraints |
| --- | --- | --- |
| id | uuid | PK default gen_random_uuid() |
| organization_id | uuid | not null → organizations.id cascade |
| metric | text | not null (e.g. `credits`, `storage_gb`) |
| bucket | text | not null; check in (`plan`,`purchased`) |
| reason | text | not null; check in (`plan_grant`,`purchase`,`consumption`,`adjustment`) |
| amount | bigint (mode number) | not null, signed (consumption negative) |
| period_start | timestamptz | null (plan grant and uses: the grant month) |
| cents | integer | null (money behind a purchase) |
| idempotency_key | text | not null |
| created_at | timestamptz | not null default now() |

Unique `(organization_id, metric, bucket, idempotency_key)`
(`credit_ledger_idempotency_unique`); index
`credit_ledger_organization_metric_idx (organization_id, metric)`.

`usage_levels`: organization_id uuid not null → organizations.id cascade;
metric text not null; value bigint not null; updated_at timestamptz not null
default now(); PK `(organization_id, metric)`.

(Behaviour of these tables is in the usage/billing spec.)

### 2.9 OAuth provider + JWT tables (better-auth `jwt()` and `@better-auth/oauth-provider`)

Generate these with the better-auth CLI for the installed versions
(`npx @better-auth/cli generate` against the auth config) and keep the column
names snake_case and table names plural; the saas-base column set (provider
1.7.7) is:

- `jwks`: id text PK; public_key text not null; private_key text not null
  (encrypted with the secret); created_at timestamptz not null; expires_at
  timestamptz null; alg text; crv text.
- `oauth_clients`: id text PK; client_id text not null unique; client_secret
  text (hashed; null for public client); client_discovery_id text; disabled
  boolean default false; skip_consent boolean; enable_end_session boolean;
  subject_type text; scopes text[]; client_credentials_scopes text[] default
  `{}`; user_id text → users.id cascade (index); created_at, updated_at
  timestamptz (nullable); name, uri, icon text; contacts text[]; tos, policy,
  software_id, software_version, software_statement text; redirect_uris text[]
  not null; post_logout_redirect_uris text[]; backchannel_logout_uri text;
  backchannel_logout_session_required boolean; token_endpoint_auth_method text;
  application_type text; jwks text; jwks_uri text; grant_types text[];
  response_types text[]; require_pkce boolean; dpop_bound_access_tokens boolean
  default false; reference_id text; metadata jsonb.
- `oauth_resources`: id text PK; identifier text not null unique; name text not
  null; access_token_ttl int; refresh_token_ttl int; signing_algorithm text;
  signing_key_id text; allowed_scopes text[]; custom_claims jsonb;
  dpop_bound_access_tokens_required boolean default false; disabled boolean
  default false; created_at, updated_at; policy_version int default 1; metadata
  jsonb.
- `oauth_client_resources`: id text PK; client_id text not null →
  oauth_clients.client_id cascade; resource_id text not null →
  oauth_resources.identifier cascade; metadata jsonb; created_at. Unique index
  `(client_id, resource_id)`, plus indexes on each column.
- `oauth_refresh_tokens`: id text PK; token text not null unique (hashed);
  client_id → oauth_clients.client_id cascade; session_id → sessions.id set
  null; user_id text not null → users.id cascade; **reference_id text** (the
  organization id); authorization_code_id text; resources text[];
  requested_user_info_claims text[]; expires_at, created_at, revoked,
  rotated_at timestamptz; rotation_replay_response text;
  rotation_replay_expires_at, auth_time timestamptz; confirmation jsonb; scopes
  text[] not null. Indexes on client_id, session_id, user_id,
  authorization_code_id.
- `oauth_access_tokens`: id text PK; token text unique; client_id cascade;
  session_id set null; user_id cascade (nullable); **reference_id text**;
  authorization_code_id; resources text[]; requested_user_info_claims text[];
  refresh_id text → oauth_refresh_tokens.id cascade; expires_at, created_at,
  revoked timestamptz; confirmation jsonb; scopes text[] not null. Indexes on
  client_id, session_id, user_id, authorization_code_id, refresh_id. (Opaque
  tokens only; JWT tokens for the MCP resource are not stored.)
- `oauth_consents`: id text PK; client_id cascade; user_id → users.id cascade;
  **reference_id text** (organization id); resources text[];
  requested_user_info_claims text[]; scopes text[] not null; created_at,
  updated_at. Indexes on client_id, user_id.
- `oauth_client_assertions`: id text PK; expires_at timestamptz not null.

The grant tables have **no FK to organizations**: `reference_id` holds the
organization id. Deleting an organization or removing a member must delete
grants explicitly (section 3.6).

If a newer better-auth version changes this column set, follow the CLI output;
the behaviour (reference_id = organization id) is what matters.

### 2.10 Tables allowed without `organization_id`

`organizations`, `users`, `sessions`, `accounts`, `verifications`, `jwks`,
`oauth_clients`, `oauth_resources`, `oauth_client_resources`,
`oauth_refresh_tokens`, `oauth_access_tokens`, `oauth_consents`,
`oauth_client_assertions`, `team_members` (reached through
`teams.organization_id`). A schema test fails for any other table lacking an
`organizationId` property mapped to `organization_id` (and still refuses a new
table named e.g. `user_profiles`, `auth_events`, `user`, `organization`).

### 2.11 better-auth adapter

`drizzleAdapter(db, { provider: 'pg', usePlural: true, transaction: true, schema: { users, sessions, accounts, verifications, organizations, members, invitations, teams, teamMembers, organizationRoles, jwkss: jwks, oauthClients, oauthResources, oauthClientResources, oauthRefreshTokens, oauthAccessTokens, oauthConsents, oauthClientAssertions } })`.
Note the `jwkss` key (plural of model `jwks`). Must work with both the
node-postgres and the PGlite Drizzle instances (`provider: 'pg'` for both).

---

## 3. Data layer API (`openData`)

`openData(config) => Promise<Data>`:

1. Open the database: `pg.Pool({ connectionString, connectionTimeoutMillis: 5000 })`
   with an `'error'` listener that only logs (an idle client failure must not
   crash the process); or PGlite at `PGLITE_DIR` (dev) / in-memory (tests).
2. Apply pending migrations. On Postgres, hold `pg_advisory_lock(724083001)`
   on one client while migrating, unlock in `finally`; if unlock fails, release
   the client with the error (destroying it). If migration fails, end the pool
   and rethrow.
3. Open storage (S3 when configured, else in-memory).
4. Start jobs (pg-boss or in-process). If that fails, close storage, end the
   pool, rethrow.
5. Return `Data`. `close()` is idempotent (memoized promise): stop jobs
   (graceful), then close storage and end the pool even if stopping fails.

`Data` members (all used by other areas; signatures to keep):

| member | behaviour |
| --- | --- |
| `deleteAccount(userId)` | Transaction: lock user `FOR UPDATE`; false if none; throw `DomainError('CONFLICT')` if they are `owner` of any org; delete invitations where `email = normalizeEmail(user.email)`; delete user (cascades sessions, accounts, members, invitations sent) |
| `account(userId, currentSessionId)` / `updateAccount(...)` | Account settings area |
| `memberOf(userId)` / `membershipIn(userId, orgId)` / `activeMembership(userId, sessionId)` | `{ organization, role }` or null: the earliest-joined membership; the one in an organization; the one in the session's active organization (else the earliest). Fresh reads |
| `revokeGrants(orgId, userId?)` | 3.6 |
| `invitationFor(invitationId, email)` | Members area (the invite email) |
| `forOrganization(id)` | Throws synchronously on non-UUID before any query. Returns `OrganizationScope` (3.1) |
| `jobs` | `JobsRuntime` (3.4) |
| `authDatabase` | better-auth adapter (2.11) |
| `health()` | Section 5 |
| `close()` | Above |

### 3.1 Tenancy (`forOrganization`)

`toOrganizationId(value)`: regex
`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`, returns
lowercase branded `OrganizationId`; else throws
`[data] not an organization id: "<value>"`. Accepts v4 and v7. Rejects: empty,
blank, `'undefined'`, `'null'`, `*`, `%`, `a/b`, UUID with trailing slash,
UUID with surrounding whitespace, 35-char near-UUID, UUID in braces.

`forOrganization(id)` validates the id synchronously (before any query) and
composes the scope under `packages/db/src/organization/`:

- `index.ts`: `organization()` (own row or undefined), `setPlan(plan, stripe?)`,
  `setStripeCustomer(customerId)`, `files` (3.2), `customRoles()`, `teamMembers(teamId)`.
- `members.ts`: `members` (`list`, `seatsTaken`, `markInvitationEmailSent`, `acceptTerms`).
- `usage.ts`: `usage` (usage spec).

Each scope function writes its own Drizzle queries and filters by the scope's
`organization_id`; callers never get a raw database handle or SQL. `Data`
for app code is typed as `ScopedData` (no `db`, no `storage`); `Data` adds
those handles for packages/db and test set-up.

### 3.2 Storage (`OrganizationFiles`)

Storage is either S3 (`R2_*` set) or in-memory (dev without a bucket, tests).
There is no local-disk storage and no presigned URL.

```ts
interface StoredFile { path: string } // relative to the organization prefix
interface OrganizationFiles {
  removePrefix(folder: string): Promise<void>
  list(folder: string): Promise<StoredFile[]>
}
interface Storage { forOrganization(id): OrganizationFiles; probe(signal?); close() }
```

`folderPrefix(orgId, folder)` (`storage/folder.ts`): `''` → `<orgId>/` (the
whole organization); otherwise the folder must end with exactly one `/`, every
segment non-empty and not `.`/`..`, no leading `/`, no backslash, no C0
control or DEL, key ≤ 1024 UTF-8 bytes; error
`[data] not a usable folder: "<folder>"`. The organization id is validated
with `toOrganizationId`.

- `list(folder)`: keys under the prefix, page by page (`listPageSize`,
  default 1000), paths relative to the organization prefix.
- `removePrefix(folder)`: lists then deletes in batches of 1000 via
  DeleteObjects; empty folder sends nothing; throws
  `[data] the bucket kept N of M objects, <key> with <code>: <message>` when
  the response lists `Errors`. A sibling sharing the prefix (`c1x/` for
  `c1/`) is never removed.
- `probe(signal)`: HeadBucket on S3; always up in memory.

S3 client: `forcePathStyle: true`, `requestChecksumCalculation: 'WHEN_REQUIRED'`,
`responseChecksumValidation: 'WHEN_REQUIRED'`.

`memoryStorage()` keeps keys in a `Set` (`objects`) and exposes
`put(organizationId, path)` so tests can seed files.

### 3.3 Config

`loadDataConfig(env)`: `DATABASE_URL` optional (absent → PGlite at
`PGLITE_DIR`, default `.data/pglite`; `PGLITE_RESET=1` wipes it at boot).
`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`:
all-or-none (partial set → error naming the missing ones); absent → in-memory
storage. `R2_REGION` defaults to `auto`. With `NODE_ENV=production`,
`DATABASE_URL` and all `R2_*` are required. Empty string counts as missing;
every missing name in one error `[data] missing env: A, B`.

### 3.4 Jobs

```ts
interface RetryPolicy { retryLimit: number; retryDelay: number /* s */; retryBackoff: boolean; expireInSeconds?: number }
interface Jobs {
  defineQueue(name, policy): Promise<void>; // creates `<name>__dead` then `<name>` dead-lettering into it; an existing queue keeps its policy
  send(name, data): Promise<string>;        // throws if not queued
  work<T>(name, handler: (data: T) => Promise<void>): Promise<void>;
}
interface JobsRuntime extends Jobs {
  probe(signal?): Promise<void> // throws when stopped or unreachable
  stop(): Promise<void>         // graceful (waits for running handlers), idempotent
}
deadLetterOf(name) = `${name}__dead`
```

There is no transactional send, no `sendOnce`, `schedule`, `find` or
`queuePolicy`: a job is sent after the rows it refers to are committed.

pg-boss implementation (real Postgres): its own `pgboss` schema; an `'error'`
listener that logs; a `health` queue created at start for the probe.

In-process runner (PGlite): same interface, jobs held in memory, polled by a
timer; retries with `retryDelay` doubling when `retryBackoff`; after
`retryLimit` retries the payload moves to `<name>__dead`; graceful `stop`
waits for running handlers; `probe` throws once stopped.

Test fake (`memoryJobs()` from `@arrakit/db/testing`): records `queues`,
`workers`, `sent` (`{ id, name, data }`).

Retry policy constant `WORKER_RETRY_POLICY = { retryLimit: 5, retryDelay: 30, retryBackoff: true }`.

### 3.5 Domain errors

Refusals the data layer raises extend `DomainError(code, message, data?)`
(`packages/db/src/errors.ts`), `code` one of `BAD_REQUEST`, `FORBIDDEN`,
`NOT_FOUND`, `CONFLICT`, `PAYMENT_REQUIRED`: `deleteAccount` throws `DomainError('CONFLICT')`
for an owner, and `UsageLimitError` (usage scope; `PAYMENT_REQUIRED` with
`{ metric, requested, available }`). The API's `reportErrors` middleware maps
every `DomainError` to an `ORPCError` with the same code, message and data
(402 for `PAYMENT_REQUIRED`), so routers do not catch them one by one. It maps
better-auth `APIError`s below 500 (from `auth.api.*` calls) the same way.
Organization refusals are better-auth `APIError`s answered by `/api/auth/*`.

### 3.6 Revoking connector grants

`data.revokeGrants(organizationId, userId?)`: delete from
`oauth_access_tokens`, `oauth_refresh_tokens`, `oauth_consents` where
`reference_id = organizationId` (and `user_id = userId` when given). Called by
the organization plugin's hooks after deleting the org (all users), removing a
member and leaving (that user only). `oauth_clients` rows always stay.

---

## 4. HTTP surface of this area

Route layout on the Hono app (port `PORT`, default 5000):

| Method | Path | Handler | Auth |
| --- | --- | --- | --- |
| GET | `/health` | health (section 5) | none |
| GET, POST | `/api/auth/*` | `auth.handler(c.req.raw)` (better-auth, includes `/api/auth/oauth2/*`, `/api/auth/jwks`) | per route |
| GET | `/.well-known/oauth-authorization-server/api/auth` | better-auth OAuth provider metadata (RFC 8414). Use the provider's metadata helper (e.g. `oauthProviderAuthServerMetadata(auth)` or the current equivalent); in saas-base the better-auth handler answered it | none |
| GET | `/.well-known/oauth-protected-resource/api/mcp` | MCP protected-resource metadata (section 7.3) | none |
| POST | `/api/mcp` | MCP Streamable HTTP, stateless | Bearer JWT |
| GET, DELETE | `/api/mcp` | 405 when authenticated (no SSE sessions); 401 challenge when not | Bearer JWT |
| ALL | `/api/rpc/*` | oRPC `RPCHandler` (other areas); the only way the contract is served | session; trusted Origin on writes |
| POST | `/api/webhooks/stripe` | billing area | Stripe signature |
| * | anything else | 404 | |

Rules from tests:

- Every route but `/health` is under `/api/` (or `/.well-known/`), because the
  browser reaches the API only through the web origin's `/api` proxy.
- Unknown route → 404 (`/api/openapi.json` and REST-style paths such as
  `/api/me` included: there is no REST serving and no OpenAPI document).
- Invalid request body to a typed procedure → 400 (oRPC Zod validation gives
  `BAD_REQUEST`).
- CSRF: one Hono middleware on `/api/rpc/*` in `apps/api/src/app.ts` refuses
  any method but GET/HEAD/OPTIONS whose `Origin` is not one of
  `authConfig.trustedOrigins` (missing, `null` or another site) with 403 and
  an oRPC error body `FORBIDDEN` `Use the app.`, before the procedure runs.
  Procedures do no Origin checks of their own.

### 4.1 Boot (`main.ts`)

0. Build the Pino logger from `LOG_LEVEL` / `LOG_FORMAT` only, so a bad env is
   still logged.
1. Load env; build the auth config eagerly (`loadAuthConfig`) so a missing
   variable fails the boot, not the first sign-in. Init Sentry when `SENTRY_DSN`
   is set.
2. Build mailer (`createMailer(process.env)`; throws in production without
   `RESEND_API_KEY`).
3. `openData(loadDataConfig(env))` (migrations applied).
4. Register the storage purge worker (`registerStoragePurge` from `workers/storage-purge.ts`,
   section 8) and build the MCP handler, passed to `createApp(deps, mcp)`.
5. Serve with `@hono/node-server`.
6. On `SIGTERM`/`SIGINT`: stop accepting, close MCP handler, `data.close()`
   (lets running jobs finish), flush Sentry, exit. Fatal boot errors: log
   `failed to start` at `fatal` and `process.exit(1)`.

### 4.2 Logs and errors

- Every request but `GET /health` (mounted first, polled by the host) gets an id
  (`X-Request-Id`, kept when sent, echoed back) and one access line `request`
  with `method`, `path`, `status`, `ms` (`warn` for a 5xx).
- `app.onError`: an `HTTPException` answers its own response; anything else is
  logged (`unexpected error`, with `requestId`, `method`, `path`), sent to
  Sentry and answered `500 {"message":"Internal Server Error"}`.
- oRPC answers procedure errors itself, so every procedure runs under a
  `reportErrors` middleware (`orpc/context.ts`) that first maps a
  `DomainError` (3.5) to an `ORPCError`, then logs and reports errors that are
  not an `ORPCError`, or are its 500 (tag `procedure`). 4xx, 502 and 503
  refusals are never reported.
- Log messages are constant; ids and amounts go in fields.

---

## 5. Health check

`GET /health` (not under `/api`; for the host).

- Runs three probes in parallel, each with a 3 s timeout
  (`AbortSignal.timeout(3000)` raced with the probe):
  - `postgres`: `select 1`.
  - `storage`: `HeadBucket` (in-memory storage: always up).
  - `queue`: pg-boss running and its `health` queue exists (fallback: runner not stopped).
- Response body, same shape for both statuses:
  `{ status: 'ok' | 'error', postgres: 'up'|'down', storage: 'up'|'down', queue: 'up'|'down' }`.
- 200 when all three up (`status: 'ok'`), else **503** with `status: 'error'`.
- A failing probe logs `health probe down` with `probe` and the error.
- Never takes longer than ~3 s (test: silent TCP endpoint → between 2.9 s and 4.5 s, storage down, others up).
- Bucket that does not exist → storage down. Queue stopped (`data.close()` called) → queue down.
- A plain Hono route registered in `app.ts`, not a contract procedure.

---

## 6. Mail

### 6.1 Mailer

```ts
interface Mail { to: string | string[]; cc?: string[]; subject: string; html: string; text: string; from?: string; replyTo?: string }
interface Mailer { send(mail: Mail): Promise<void> }
createMailer(env, deps?: { fetch?, log? }): Mailer
```

- With `RESEND_API_KEY`: `POST https://api.resend.com/emails`, headers
  `authorization: Bearer <key>`, `content-type: application/json`, body
  `{ from, reply_to?: [replyTo], to: string[], cc?: string[], subject, html, text }`.
  `from` = mail.from ?? `MAIL_FROM` ?? `App <hello@example.com>` (arrakit
  default: `Arrakit <hello@example.com>`). `reply_to` only when replyTo is
  non-empty; `cc` only when non-empty. `to` always an array. (Using the
  official `resend` SDK is fine if the payload stays equivalent.)
- Non-2xx → throw `[mail] Resend refused the email: <status> <body>`. The error
  must **not** contain the subject or recipients.
- Without a key, with `MAILPIT_URL` (dev, e2e): POST every mail to Mailpit's
  `<MAILPIT_URL>/api/v1/send` (`From`, `To`, `Cc`, `ReplyTo`, `Subject`, `HTML`, `Text`).
  Unreachable or non-2xx → throw. Playwright reads magic links from Mailpit's API.
- Without either: log-only mailer. One log line per mail:
  `Neither RESEND_API_KEY nor MAILPIT_URL is set, so nothing is sent. From <from> to <a, b>[, Cc <c>][, Reply-To <r>]: <subject>\n<text>` (link included).
  Tests use `recordingMailer()` (`{ mailer, sent }`).
- `NODE_ENV=production` without key → throw at creation:
  `[mail] missing env: RESEND_API_KEY (production never logs sign-in links)`.

### 6.2 Email layout (packages/emails)

Pure functions; nothing sends. `composeEmail({ subject, heading: { lead, tail }, blocks, footer?, organization?, replyTo? }) => { replyTo: string|null, subject, html, text }`.

Blocks (`kind`): `paragraph(text|Rich)`, `note`, `bullets(items)`,
`actions(primary, secondary?)`, `choices(actions)`, `rows([label,value][])`,
`sections({label,text,open?}[])`, `panel`, `quote(text)`, `event(card)`,
`signature(name)`. `Rich = (string | {text, href})[]`, `link(text, href)`.

- HTML: table layout, inline styles, `<html lang="en">`, masthead `APP_NAME`
  in a `<td>` (`>${APP_NAME}</td>`), `<h1>` with lead + grey tail, footer under
  a rule. Styles are free to change (no need to copy saas-base colours).
- Text part rendered from the same blocks (never stripped HTML): heading
  `lead tail`, blocks joined by blank lines, links as `text (href)`, actions as
  `label: href`, rows `label: value`, sections `LABEL\ntext`, quote `“text”`,
  footer `--\n<footer>` last, trailing newline.
- Escaping: all text and attributes escaped (`& < > " '` → entities). Subject
  and text keep raw values.
- Link guard: hrefs must match `^(https://|mailto:|http://(localhost|127\.0\.0\.1)(:\d+)?/)` (case-insensitive), else throw `An email link must be https: or mailto:, got "<url>"` (`javascript:`, plain `http://app...`, `http://localhost.evil.com/x` are refused).

### 6.3 Account templates

- `signinEmail({ minutes, links: { signIn } })` ("MailSignin"):
  subject `Your link to sign in to ${APP_NAME}`; heading `Sign in` / `to ${APP_NAME}.`;
  paragraph `The link works once, for ${count(minutes,'minute')}.`; action
  `Sign in` → link; note `Didn't ask for this? Ignore this email.`; no Reply-To.
- `memberEmail({ organization: { name }, inviter, expiresInDays, links: { join } })` ("MailMember"):
  subject `${firstName(inviter)} invited you to ${org} on ${APP_NAME}`;
  heading `Join ${org}` / `on ${APP_NAME}.`; paragraph
  `${inviter} invited you to work with them in ${org}.`; action `Join ${org}`
  → join link; note `The invite expires in ${count(days,'day')}.` (1 → "1 day").

API wrappers (`mailSignin({ to, url, minutes })`, `mailMember({ to, url, organization, inviter: { name, email }, expiresInDays })`):
inviter display name = trimmed name, or the email local part when blank.
Link appears verbatim in text and with `&` escaped as `&amp;` inside the HTML
`href`.

Plan emails (`receiptEmail`, `renewEmail`, `failedEmail`, `canceledEmail`,
`downgradedEmail`) belong to the billing spec but live in the same package.

### 6.4 Copy helpers (packages/emails `copy.ts`; also used by the web)

`CopyLang = 'en'|'es'`. Days are `YYYY-MM-DD` strings parsed as three numbers
(never `new Date('YYYY-MM-DD')`); invalid → throw `"<x>" is not a calendar day (YYYY-MM-DD)`.
`firstOfNextMonth`, `daysBetween`, `dayWithWeekday` ("Fri, Oct 9" / "vie, 9 oct"),
`shortDay` ("Oct 4" / "4 oct"), `fullDay` ("Oct 4, 2027" / "4 oct 2027"),
`monthOf`, `dateTile` (["FRI","9"]), `clockTime` ("10:00"→"10:00 AM", "00:30"→"12:30 AM"; es 24h "9:05"),
`meetingWhen(date, tz, lang)` ("Fri, Oct 9 · 10:00 AM"), `clockRange`
("10:00 to 11:00 AM", "11:30 AM to 12:30 PM"; es "10:00 a 11:00"),
`count(n, one, many?)`, `countWord` (One..Ten / Una..Diez, numeral past ten),
`initial`, `firstName`, `listing` ("a, b and c" / "a, b y c").

---

## 7. MCP server with OAuth 2.1

### 7.1 Auth configuration relevant to the connector

`loadAuthConfig(env)` (shared with the auth spec): requires
`BETTER_AUTH_SECRET` (min 32 chars) and `BETTER_AUTH_URL`; `WEB_URL` optional.
`webOrigin` = origin of `WEB_URL` or of `BETTER_AUTH_URL`; `trustedOrigins` =
unique [base origin, web origin]. `MCP_PATH = '/api/mcp'`;
`mcpResourceURL(baseURL) = new URL('/api/mcp', baseURL)`;
`oauthIssuer(baseURL) = new URL('/api/auth', baseURL)` (string form, no trailing slash).

better-auth options needed by this area:

- `basePath: '/api/auth'`, `baseURL`, `secret`, `trustedOrigins`,
  `emailAndPassword.enabled: false`, `telemetry.enabled: false`,
  `advanced.cookiePrefix: 'arrakit'` (saas-base: `'saas'`),
  `advanced.disableOriginCheck: false`,
  `advanced.ipAddress.ipAddressHeaders: ['x-real-ip','x-forwarded-for']`.
- `disabledPaths: ['/token']`: the jwt plugin's session-to-JWT route is closed
  (`GET /api/auth/token` → 404). Tokens only come from the OAuth flow.
- The organization plugin serves `/api/auth/organization/*` (organizations
  spec). Before-hook: `/sign-in/social` and `/sign-in/magic-link` require an exact
  trusted `Origin` header, else 403 `Sign in from the app.`
- `jwt({ disableSettingJwtHeader: true, jwt: { issuer: oauthIssuer(baseURL) } })`.
  Keys in `jwks`; `GET /api/auth/jwks` serves public keys whose `kid`s equal
  `jwks.id` rows (exactly one row after first use).
- `oauthProvider({ loginPage: `${webOrigin}/oauth/signin`, consentPage: `${webOrigin}/oauth/consent`, allowDynamicClientRegistration: true, allowUnauthenticatedClientRegistration: true, grantTypes: ['authorization_code','refresh_token'], resources: [mcpResourceURL], clientRegistrationDefaultResources: [mcpResourceURL], postLogin: { page: `${webOrigin}/oauth/consent`, shouldRedirect: ({ user, session }) => no usable organization, consentReferenceId: ({ user, session }) => session.activeOrganizationId while the person is still in it, else their earliest organization, or throw APIError('FORBIDDEN', { error: 'access_denied', error_description: 'You are not in an organization here.' }) }, customAccessTokenClaims: ({ referenceId }) => referenceId ? { organization_id: referenceId } : {} })`.
  Check the current `@better-auth/oauth-provider` docs for option names; keep
  the behaviour.
- `ORGANIZATION_CLAIM = 'organization_id'`.

### 7.2 OAuth behaviour (from `oauth-provider.spec.ts`)

1. `GET /.well-known/oauth-authorization-server/api/auth` → 200 with
   `issuer = <BETTER_AUTH_URL>/api/auth`, `authorization_endpoint = <issuer>/oauth2/authorize`,
   `token_endpoint = <issuer>/oauth2/token`, `registration_endpoint = <issuer>/oauth2/register`,
   `code_challenge_methods_supported` contains `S256`,
   `grant_types_supported` contains `refresh_token` and **not** `client_credentials`.
2. `POST /api/auth/oauth2/register` with
   `{ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none' }`,
   no cookie, no Origin → 201 with `client_id` and same `redirect_uris`.
   Stored in `oauth_clients` (name, redirect_uris) and linked in
   `oauth_client_resources` to `<base>/api/mcp`.
3. (removed: the organization plugin now serves `/api/auth/organization/*`.)
4. `GET /api/auth/token` with session → 404.
5. `POST /api/auth/sign-in/magic-link` without Origin → 403.
6. `GET /api/auth/oauth2/authorize?response_type=code&client_id&redirect_uri&state&code_challenge&code_challenge_method=S256&resource=<mcp>`
   without session → 302 to `<web>/oauth/signin?...client_id=...&sig=...` (signed query).
7. Same with session of an org member → 302 to `<web>/oauth/consent?...`.
   Consent `POST /api/auth/oauth2/consent` `{ accept: true, oauth_query }`
   (with cookie + trusted Origin) → JSON `{ url }` = redirect URI with `code`.
   Token exchange (`POST /api/auth/oauth2/token`, form-encoded,
   `grant_type=authorization_code, code, code_verifier, redirect_uri, client_id, resource=<mcp>`)
   → `{ access_token (JWT), refresh_token, token_type, expires_in, scope }`.
   JWT claims: `sub = userId`, `organization_id = org.id`, `iss = issuer`,
   `aud` contains the MCP URL.
8. Refresh (`grant_type=refresh_token, refresh_token, client_id, resource`) →
   200, a different access token, still `organization_id`.
9. Wrong PKCE verifier → no token (better-auth 1.7.7 answers 401
   `invalid_request`; accept whatever error the current version gives, but no
   `access_token`).
10. Person with no organization: authorize → 302 to consent; consent accept →
    body has no `url`, `error: 'access_denied'`; consent deny → `url` is the
    client callback with `error=access_denied` and no `code`.
11. Resume after magic link: the sign-in page asks for a magic link with
    `callbackURL = <base>/api/auth/oauth2/authorize?<original query minus sig, exp, ba_iat, ba_pl, ba_param>`
    and `errorCallbackURL = <web>/signup`; opening the link → 302 back to that
    authorize URL (same params); following it with the new cookie → 302 to
    consent with the same `client_id`.

Access tokens expire (test moves clock +2 h → 401). Default TTLs of the
provider are fine.

### 7.3 MCP endpoint

Protected-resource metadata `GET /.well-known/oauth-protected-resource/api/mcp`
→ 200 `application/json`:
`{ resource: <base>/api/mcp, authorization_servers: [<issuer>], bearer_methods_supported: ['header'], resource_name: APP_NAME }`.

Bearer parsing (`bearerToken(header)`): regex
`^Bearer +([A-Za-z0-9\-._~+/]+=*)$` case-insensitive. Accept: `Bearer abc`,
`bearer abc`, `BEARER abc`, a JWT, two spaces, trailing `==`. Reject (null):
`Basic abc`, `Token abc`, `Bearerabc`, `Bearer`, `Bearer    `, `Bearer a b`,
`Bearer x, Bearer y`, `Bearer a"b`, `Bearer a=b`, empty, undefined. A
`?access_token=` query parameter is never read.

`verifyAccessToken(authorization)` → `ConnectorCaller | null`:
1. No bearer → null.
2. Verify JWS against the API's own JWKS (`auth.api.getJwks()`, cached by
   better-auth's `verifyJwsAccessToken` from `better-auth/oauth2` or the
   current equivalent) with `issuer` and `audience = mcp resource`.
   Invalid signature/alg none/other key/other `aud`/other `iss`/expired → null.
   **If reading the JWKS itself fails, rethrow → 500, no `www-authenticate`.**
3. Claims `sub` and `organization_id` must be strings, else null.
4. `membershipIn(sub, claim)` read fresh; null when the person is not (or no
   longer) in that exact organization. The grant stays bound to the
   organization that was active at consent, whatever the session switches to later.
5. Return `{ userId, organizationId, role, organizationSlug, clientId: claims.client_id ?? '', scopes: claims.scope split by space }`.

Unauthenticated response: 401, `content-type: application/json`, body
`{"error":"invalid_token"}`, header
`www-authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource/api/mcp"`
and, only when a bearer token was presented and refused, `, error="invalid_token"` appended.

Authenticated:
- POST: JSON-RPC over Streamable HTTP, **stateless** (new MCP server per
  request, no session id), keep-alive off. Pass `authInfo` with
  `{ token, clientId, scopes, resource, extra: { organizationId, userId, role, organizationSlug } }`.
  The server factory reads the caller only from `authInfo.extra`, never from
  tool arguments; throws `[mcp] a request without a verified person` if missing.
  Response may be JSON or SSE; Accept `application/json, text/event-stream`.
- GET (SSE) and DELETE → 405.
- Client disconnect mid-stream is logged as a warning, not an error.

Server: name `arrakit` (saas-base `saas`), version `0.1.0`, capabilities
`tools.listChanged: false`, instructions:
`This server acts as one person in one of their organizations: the person who connected it. Use whoami to read who that is and their organization. Add a tool per thing the product does; every tool reads the caller from the token, never from its arguments.`

Tools (exactly this list today: `tools/list` → `['whoami']`):

- `whoami`: title `Who am I`; description `The person this connection acts as: their organization and their role in it.`;
  no input; annotations `readOnlyHint: true, openWorldHint: false`;
  `outputSchema` = `{ organization: { id, name, slug, plan }, role }` (role
  description: `The person's role in it: owner, admin, member or a custom role`).
  Result: `content: [{ type: 'text', text: '<org name> (<role>)' }]`,
  `structuredContent` = the output. If the org row is gone:
  `{ isError: true, content: [{ type: 'text', text: 'The organization is gone.' }] }`.

Revocation rules (tests):
- Removing a member (members area) revokes that user's grants in that org in
  the same transaction; their access tokens (original and refreshed) get 401
  on the next call (membership check), their refresh token now fails (400);
  other members' and other orgs' tokens keep working.
- Deleting the org (`DELETE` org endpoint, owner) revokes all its grants;
  its refresh token → 400; another org's → 200.

---

## 8. Storage purge worker

Queue `storage-purge` defined with `WORKER_RETRY_POLICY` (5 retries, 30 s,
backoff) at boot; worker registered at boot.

Job payload: `{ organizationId: string, folder: string }`. `folder` is
slash-terminated under the org prefix; `''` = every file of the org.

- `registerStoragePurge(data, log)` defines the queue and registers the worker:
  `forOrganization(job.organizationId).files.removePrefix(folder)`. On failure
  log `storage purge failed; the queue retries it, then dead-letters it` with
  `organizationId`, `target` and the error, then rethrow (retried,
  dead-lettered after last attempt). Target text: `folder "<folder>"` /
  `folder "<all>"` for `''`.
- `queueStoragePurge(jobs, job, log)`: sends the job; if send fails, log
  `storage purge not queued; its files stay in the bucket` with
  `organizationId` and `target`, and **do not throw** (the delete succeeded).
- Used by: organization delete (owner) → `{ organizationId, folder: '' }` after
  the rows are deleted.

---

## 9. Web screens (apps/web)

Both screens are public routes (no auth guard), centered single-column
layouts with shadcn/ui components (Card optional, Button, Input, Label,
Alert). No app shell. i18n namespace `oauth` (copy below, en and es from
saas-base). Page titles: `app.titles.signInToConnect` ("Sign in to connect"),
`app.titles.connect` ("Connect").

### 9.1 `/oauth/signin` (OAuthSignInPage)

Purpose: better-auth sends a connector's authorization here when nobody is
signed in.

- Builds `resume` = `/api/auth/oauth2/authorize?<params>` from the page's
  query, keeping only these names (all values, in order):
  `response_type, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, nonce, prompt, resource, max_age, display, ui_locales, acr_values, login_hint, claims`.
  Drops `sig`, `exp`, `ba_*`, `next`, `via`, `error`, anything else.
  `prompt`: remove the `login` value (space-separated); drop `prompt` if
  nothing remains (`prompt=login consent` → `prompt=consent`). Values are
  URL-encoded so the path cannot leave authorize (`redirect_uri=https://evil.example`
  stays a query value; `state=//evil.example/x` stays encoded; result always
  path `/api/auth/oauth2/authorize` on the web origin).
- `resume === null` (no `client_id`) → state **incomplete**: h1
  `oauth.oauthSignin.incompleteTitle`, p `oauth.oauthSignin.startAgain`; no
  buttons, nothing sent.
- Otherwise state **options**: h1 `titleStart` + muted `titleEnd`
  ("Sign in to" "connect SaaS" → use APP_NAME), p `useOrganizationAccount`,
  then the shared **SignInOptions** component (from the auth area) with
  `landing = resume`:
  - "Continue with Google" / "Continue with Microsoft" buttons, each shown only
    when the API reports a client for it (auth-providers endpoint of the auth
    area). Click → better-auth `signIn.social({ provider, callbackURL: resume, errorCallbackURL: <current page URL with via=<provider>> })`;
    after one click all sign-in buttons stay disabled (window is leaving).
  - Email input (label `auth.signInOptions.workEmail`, placeholder
    `yourWorkEmail`) + "Continue": email trimmed + lowercased
    (`' Lucia.Gomez@Cierzo.vc '` → `lucia.gomez@cierzo.vc`), work-email
    validation error `workEmailError`; sends magic link with
    `callbackURL = resume`, `errorCallbackURL = current page`.
    On success → state **check-your-email** (CheckYourEmail, internal to `sign-in-options.tsx`:
    h1 "Check your" "email.", `sentTo` with the email, `linkWorksOnce`,
    button `useDifferentEmail` which returns to options with the last email prefilled).
    On failure → `linkNotSent`.
  - Query `error=INVALID_TOKEN` (used/expired magic link) → alert
    `auth.signInOptions.linkRefused` above the options, options still shown.
  - Query `via=<provider>&error=<anything>` (e.g. `email_not_verified`) →
    alert `providerRefused` with provider name ("Microsoft"/"Google"); the
    resumed URL excludes `via` and `error`.

### 9.2 `/oauth/consent` (OAuthConsentPage)

Purpose: signed-in person allows/denies the connector.

- `oauthQuery` = the page's full query string exactly as received (every
  name/value in order, signature included; better-auth checks the signature
  over it).
- No `client_id` or no `sig` → state **incomplete** (h1
  `oauthConsent.incompleteTitle`, p `startAgain`); no API calls, no buttons.
- Otherwise state **loading** (`loading`, role=status) while fetching in
  parallel:
  - `GET /api/auth/oauth2/public-client?client_id=<id>` (credentials) →
    name = `client_name || client_id`.
  - Current organization (the `me` procedure of the account/org area; null
    when none).
- Any fetch error → state **unavailable** (h1 `unavailableTitle`, p
  `startAgain`); error reported to the error handler/logger.
- Org present → state **ask**: h1 `connect` + muted client name; p
  `willSee` ({client, organization}); buttons **Allow** (primary, full width)
  and **Deny** (ghost). Exactly these two buttons.
- No org → state **no-organization**: h1 `noOrganizationTitle`, p
  `noOrganizationBody` ({client}); single button `backTo` ({client}) which
  denies.
- Answer: `POST /api/auth/oauth2/consent` `{ accept, oauth_query }` with
  credentials; response `{ url }` or `{ redirect_uri }` → `window.location.href = url`
  (full-page redirect to the client). No url → treat as error.
  While pending, buttons disabled; on error, re-enable, show alert (role=alert)
  `failed`, report the error; a second click retries (2 consents recorded).
- Allow and Deny both send the identical `oauthQuery`.

Use better-auth's React client plugin for the OAuth provider if it exposes
`oauth2.consent` / `publicClient`; otherwise plain `fetch` (these are
better-auth routes, not oRPC procedures).

### 9.3 Copy keys (`oauth.*`)

en:
```json
"oauth": {
  "oauthSignin": {
    "incompleteTitle": "This link is incomplete.",
    "startAgain": "Start again from the app you were connecting {{appName}} to.",
    "titleStart": "Sign in to",
    "titleEnd": "connect {{appName}}",
    "useOrganizationAccount": "Use your organization's account. You'll see what is shared before anything is."
  },
  "oauthConsent": {
    "loading": "Loading…",
    "incompleteTitle": "This link is incomplete.",
    "startAgain": "Start again from the app you were connecting {{appName}} to.",
    "unavailableTitle": "Couldn't open this request.",
    "connect": "Connect",
    "willSee": "{{client}} will act as you in {{organization}}.",
    "allow": "Allow",
    "deny": "Deny",
    "noOrganizationTitle": "You're not in an organization yet.",
    "noOrganizationBody": "{{client}} acts within an organization. Join yours, or set one up, then connect again.",
    "backTo": "Back to {{client}}",
    "failed": "Couldn't finish connecting. Try again."
  }
}
```
es:
```json
"oauth": {
  "oauthSignin": {
    "incompleteTitle": "Este enlace está incompleto.",
    "startAgain": "Vuelve a empezar desde la app a la que estabas conectando {{appName}}.",
    "titleStart": "Inicia sesión para",
    "titleEnd": "conectar {{appName}}",
    "useOrganizationAccount": "Usa la cuenta de tu organización. Verás qué se comparte antes de que se comparta nada."
  },
  "oauthConsent": {
    "loading": "Cargando…",
    "incompleteTitle": "Este enlace está incompleto.",
    "startAgain": "Vuelve a empezar desde la app a la que estabas conectando {{appName}}.",
    "unavailableTitle": "No se ha podido abrir esta solicitud.",
    "connect": "Conectar",
    "willSee": "{{client}} actuará como tú en {{organization}}.",
    "allow": "Permitir",
    "deny": "Denegar",
    "noOrganizationTitle": "Aún no estás en ninguna organización.",
    "noOrganizationBody": "{{client}} actúa dentro de una organización. Únete a la tuya, o crea una, y vuelve a conectar.",
    "backTo": "Volver a {{client}}",
    "failed": "No se ha podido completar la conexión. Inténtalo de nuevo."
  }
}
```
(saas-base hard-codes "SaaS" where `{{appName}}` is; es fixes the typo "ningún organización".)
Shared keys used: `auth.checkYourEmail.*`, `auth.signInOptions.*`,
`app.titles.signInToConnect`, `app.titles.connect`.

### 9.4 Dev proxy and same-origin rule

The web and API must be one site (session cookie is first-party).
`BETTER_AUTH_URL` = the web origin (dev `http://localhost:5000`-style web
port; saas-base used 4200). Vite dev server proxies to the API:
`/api` and `/.well-known/oauth-authorization-server`,
`/.well-known/oauth-protected-resource` (only those `.well-known` prefixes).
A production proxy (if any) must: keep path+query, method, body (streamed,
`duplex: 'half'`), cookie and origin; set `x-forwarded-host` and
`x-forwarded-proto`; map `cf-connecting-ip` → `x-forwarded-for` when present;
`redirect: 'manual'` (redirects go to the browser).

---

## 10. Background jobs summary

| queue | sender | worker | policy |
| --- | --- | --- | --- |
| `storage-purge` | org delete via `queueStoragePurge` | `registerStoragePurge` | 5 retries, 30 s, backoff, dead letter `storage-purge__dead` |
| `health` | none | none (probe only, pg-boss) | default |

No cron schedules (the `Jobs` interface has none). Usage plan grants are
computed on read (no job).

---

## 11. Env vars

| var | required | notes |
| --- | --- | --- |
| `NODE_ENV` | no | `production` makes Google client, `RESEND_API_KEY`, `DATABASE_URL`, `R2_*` mandatory |
| `PORT` | no | default 5000 |
| `DATABASE_URL` | prod | Postgres; absent → PGlite |
| `PGLITE_DIR` | no | PGlite data dir in dev, default `.data/pglite`; `PGLITE_RESET=1` wipes it at boot |
| `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | prod (all or none) | S3-compatible bucket; absent → in-memory storage |
| `R2_REGION` | no | default `auto` |
| `BETTER_AUTH_SECRET` | yes | ≥ 32 chars |
| `BETTER_AUTH_URL` | yes | public web origin (where `/api/auth` is reached); must be a URL |
| `WEB_URL` | no | web origin when different |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | pair; required in prod | redirect `<BETTER_AUTH_URL>/api/auth/callback/google` |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | pair; optional | redirect `<BETTER_AUTH_URL>/api/auth/callback/microsoft`; tenant `common` |
| `RESEND_API_KEY` | prod | absent → Mailpit (`MAILPIT_URL`) or log |
| `MAIL_FROM` | no | default `Arrakit <hello@example.com>` |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | no | billing; without all three (and without `STRIPE_FAKE=1`) every Stripe call answers 503 |
| `STRIPE_FAKE` | no | `1`: in-memory fake gateway (dev, e2e); refused in production |
| `LOG_LEVEL` | no | Pino level; default `silent` in tests, `info` otherwise |
| `LOG_FORMAT` | no | `json` or `pretty`; default `pretty` in development, `json` otherwise |
| `SENTRY_DSN` | no | report unexpected errors to Sentry; absent → only logged |
| `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | no | environment defaults to `NODE_ENV` |
| `API_ORIGIN` | web/proxy only | where the web proxies `/api` (dev default `http://localhost:3001` or as AGENTS.md sets) |

Provide `apps/api/.env.example` documenting all of these (port the saas-base
comments).

---

## 12. Tests worth porting (Vitest; PGlite in-memory instead of containers)

Data package:
- `schema.spec.ts` – every table but the exceptions has `organization_id`; still refuses new tables without it; OAuth tables present.
- `organization-id.spec.ts` – all accept/reject cases (3.1).
- `storage` – memory storage: removePrefix keeps a sibling sharing the prefix
  (`c1x/` for `c1/`) and other organizations; unusable folders and ids refused.
  S3 against a mocked client: folder validated before listing, batches of
  1000, paging with `listPageSize`, `Errors` reported, HeadBucket probe; an
  optional integration test against a real bucket.
- `jobs` – in-process runner and pg-boss: retry with backoff then dead letter;
  fail-once-then-succeed; redefining a queue keeps its policy; stop waits for
  running handlers, then the probe fails; `memoryJobs()` records and runs sends.
- `health` – all up; storage down; queue down after close; hanging probe ≈3 s.
- `config.spec.ts` – env parsing (adapted to optional DB/R2).
- `delete-organization` – cascades every org table (discovered from the
  schema), another org intact, people kept,
  grants revoked only for that org, idempotent false, uppercase id, non-UUID throws.
- `delete-account` – member deleted with sessions/accounts/memberships/
  invitations sent and to them; admin removed leaves org whole; owner refused
  (`DomainError('CONFLICT')`, nothing deleted); owner of any org refused; unknown → false.
- `auth-database` integration – magic link sign-in writes users/sessions,
  verification consumed; two parallel clicks → exactly one session, the other
  redirected with `error=INVALID_TOKEN`; deleting user ends sessions; unauthenticated
  client registration stored with resource link; `/api/auth/jwks` kid = jwks.id, one row.
- `lint-guard.spec.ts` – driver imports refused in apps/api, allowed in the db package.

API:
- `health` route (200/503, the only route outside `/api`); `app` (unknown → 404,
  no REST or OpenAPI paths, cross-site `/api/rpc` writes → 403 `Use the app.`).
- `mailer.spec.ts`, `mail-signin.spec.ts`, `mail-member.spec.ts`.
- `mcp.test.ts`: `bearerToken`, the OAuth provider (all 11 cases of 7.2) and the MCP endpoint
  (challenge + metadata, tools list, whoami structured content, token in URL
  refused, forged tokens refused: garbage, other key, alg none, other aud,
  other iss, no org claim, org not theirs; expiry; member removal revokes;
  org delete revokes; GET → 405; JWKS failure → 500 without challenge).
  Use Better Auth test utilities (`testUtils` plugin / test helpers, check
  current docs) to create users, sessions and cookies instead of driving magic
  links where the flow itself is not under test; keep at least one full
  magic-link flow (read link from `recordingMailer().sent`).
- `storage-purge.test.ts` (queue defined with policy, runs via queue, logs+throws
  on bucket failure, `queueStoragePurge` logs and does not throw).

Emails: `compose.spec.ts`, `account.spec.ts`, `copy.spec.ts`.

Web (Vitest + React Testing Library): OAuth signin page (providers shown per
API, magic link lands on authorize without signature and lowercased email,
Google/Microsoft landings, buttons disabled after one social click, Microsoft
refusal message and resume without `via`/`error`, INVALID_TOKEN message,
incomplete link, `prompt=login` dropped, open-redirect cases) and consent page
(ask state with Allow/Deny, allow/deny send identical query, API failure
alert + retry, no-organization back button denies, incomplete without sig).

Playwright e2e: full Claude-like connector flow in the browser: register a
client via API, open authorize URL, sign in by magic link (read from
Mailpit), consent Allow, assert redirect to callback with `code`; then call
`/api/mcp` `whoami` with the exchanged token.

---

## 13. Edge cases and business rules (checklist)

- An organization id is always validated and lowercased before reaching SQL or a storage key.
- Raw SQL is never available to callers of `forOrganization`.
- Org delete order: end Stripe subscription (billing, `beforeDeleteOrganization`) → better-auth deletes the rows → revoke grants and queue purge (`afterDeleteOrganization`).
- Purge send failure never fails the user's delete.
- A refused MCP token and an internal JWKS failure are distinguished (401 vs 500).
- Membership is read fresh on every MCP call; tokens are not revoked by time alone.
- `GET /api/auth/token` is closed (404); `/api/auth/organization/*` is the organization plugin.
- Writes to `/api/rpc/*` from an untrusted Origin are refused (403) before any procedure runs.
- Magic link and social sign-in require an exact trusted Origin (no Origin, `null`, lookalike host, other scheme/port → 403).
- Mailer errors never leak subject or recipients.
- Production refuses to boot without `RESEND_API_KEY` (and without Google, DB, bucket).
- Email links: only https, mailto, or http://localhost / 127.0.0.1.
- The consent page sends the query exactly as received; the sign-in page never forwards `sig`/`ba_*`/unknown params.
- Migrations run under an advisory lock (two instances booting together).
- `close()` is idempotent and stops jobs before ending the pool.
