# Arrakit

A starting point for B2B SaaS products: sign-in, organizations with members and roles, Stripe
billing, prepaid credits, transactional email and an MCP server, in a pnpm + Turborepo monorepo.

| Piece          | What                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| `apps/api`     | Hono + oRPC API under `/api`: auth, organizations, members, billing, usage, MCP, jobs |
| `apps/web`     | TanStack Start app (React 19, shadcn/ui, i18next en/es): onboarding, settings, plans  |
| `apps/landing` | The static landing page (Astro)                                                       |

## What it does

- **Sign-in** with Better Auth: magic link by email, Google and Microsoft (the social buttons
  hide when their keys are unset).
- **Organizations** (Better Auth's organization plugin): created on Profile or by Skip (named
  from the email domain), renamed, deleted by their owner.
- **Members and roles**: `owner`, `admin`, `member`; invitations by email with a magic link back
  to the join page; seats limited by the plan.
- **Billing** with Stripe: Embedded Checkout, plan and cycle changes with a priced preview, cancel
  and resume, the customer portal, receipts and failed-payment emails from the webhook. Plans and
  prices live in `packages/plans`. With `STRIPE_FAKE=1` an in-memory gateway stands in for Stripe.
- **Prepaid credits and usage metrics**: each plan grants an amount of money a month, turned into
  every metric (`credits`, `storage_gb`) by its own factor; admins top up any amount on Stripe
  Checkout, which adds to every metric at once and never expires. Uses spend the plan's grant
  first. See [Credits and usage](#credits-and-usage).
- **Email** through Resend, rendered from `packages/emails`; without `RESEND_API_KEY` mail goes
  to a local Mailpit inbox (http://localhost:5025, started by `pnpm dev`).
- **MCP server** at `/api/mcp`, with OAuth 2.1 sign-in through Better Auth's OAuth provider
  (Claude's custom connectors work with it) and one example tool, `whoami`.
- **Files** for the organization and for each workspace: browsers upload and download straight to
  any S3-compatible bucket with presigned URLs; the plan sets the allowed types and the size limit,
  and stored bytes count against `storage_gb`. Uploads, renames and deletions publish durable
  events that background subscribers react to. `pnpm dev` starts a local RustFS bucket.
- **Jobs** with pg-boss on the same Postgres (on the PGlite instance too when `DATABASE_URL` is unset).
  Tracked jobs are **tasks** people follow in each workspace and in Settings: status, retries and progress, streamed to
  the web as they change, with `task.succeeded` and `task.failed` events to react to.
- **Tenancy**: every organization query and file key goes through `forOrganization(id)` in
  `@arrakit/db`; ESLint refuses the database and storage drivers anywhere else.

## Credits and usage

The catalog is `packages/plans/src/index.ts`: `CURRENCY`, `TOP_UP` (the amount a top-up may
be), `METRICS` and each plan's `monthlyGrantCents`. A metric is `consumable` (each use spends a
balance; refused at zero, like `credits`) or `capacity` (grants and top-ups raise a limit; the app
reports the level, like `storage_gb`), and `perCurrencyUnit` says how much of it $1 buys.

- **Add a metric**: one line in `METRICS`, and its words in
  `apps/web/src/i18n/locales/{en,es}/usage.json` (`metric`, `amount`). Plans grant it and top-ups
  buy it from then on; no migration.
- **Change a conversion or a grant**: edit `perCurrencyUnit` or `monthlyGrantCents`. It applies to
  grants and top-ups from then on; what was bought stays as it was credited.
- **Spend it from the API**: put `requiresUsage('credits', 5)` (`apps/api/src/usage/requires-usage.ts`)
  on a procedure, or call the `UsageService` (`apps/api/src/usage/usage-service.ts`). `can()` and
  `check()` ask, `consume(org, metric, qty, idempotencyKey)` spends, `set(org, metric, level)`
  reports a capacity level; a refusal is 402 with a message pointing to Add credits. Below the API
  it is `forOrganization(id).usage` in `@arrakit/db`.

How it holds together: an append-only `credit_ledger` (grants, purchases, uses, adjustments, each
idempotent by key) and `usage_levels`. A plan's grant for the month is written on the first read or
use in it (no job walks every organization); months count from the Stripe subscription's billing
anchor on a paid plan and from signup on Free, and last month's unused grant lapses. Top-ups are
Checkout in payment mode on the "Credits" product (`pnpm --filter @arrakit/api stripe:prices`
creates it with its custom-amount price); the webhook credits `checkout.session.completed` (and
`checkout.session.async_payment_succeeded`) once per session, and takes credits back on
`refund.created` and `charge.dispute.created`. Subscribe the webhook endpoint
(`/api/webhooks/stripe`) to those four events too.

## This repo

| Path                | What                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| `packages/db`       | Drizzle schema and migrations, tenancy, jobs (pg-boss), storage (S3)  |
| `packages/contract` | The oRPC contract (Zod) the API implements and the web calls          |
| `packages/auth`     | Better Auth setup (magic link, social, organizations, OAuth provider) |
| `packages/plans`    | Plans, prices, metrics and the usage arithmetic                       |
| `packages/address`  | Email, slug, organization-name and time-zone rules                    |
| `packages/emails`   | Email layout and templates                                            |

The layout, package boundaries and rules are in [AGENTS.md](AGENTS.md).

## Run it

Node 24 and pnpm 12 (`engines` and `packageManager` in `package.json`).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm dev        # api :5000 (migrations applied on boot), web :5200 (/api proxied), landing :5321
```

Every variable is optional in development: without `DATABASE_URL` the API uses PGlite in
`PGLITE_DIR`, without `RESEND_API_KEY` mail goes to Mailpit (`MAILPIT_URL`), or to the console when that is unset, with
`STRIPE_FAKE=1` Stripe is faked, and the `R2_*` keys of `.env.example` point at the local RustFS
(without them uploads are kept in memory). In production set `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`/`WEB_URL` (the web origin), `RESEND_API_KEY` and `MAIL_FROM`, the `STRIPE_*`
keys and the `R2_*` bucket, whose CORS rule must allow PUT and GET from the web origin. When
`DATABASE_URL` goes through a pooler in transaction mode, set `DATABASE_DIRECT_URL` to the direct
host: the migration lock and the task feed's `LISTEN` need a session. The web reads
`API_ORIGIN`, `VITE_APP_NAME` and `VITE_SITE_URL`.

With real Stripe keys, create the products and prices once:
`pnpm --filter @arrakit/api stripe:prices`. The OpenAPI document of the API is written by
`pnpm --filter @arrakit/api openapi:export <file>`.

## Check it

```bash
pnpm typecheck
pnpm lint
pnpm test       # Vitest: unit, API integration on PGlite, React Testing Library
pnpm test:e2e   # Playwright: boots the api (throwaway PGlite, fake Stripe) and the web
pnpm format:check
```

`pnpm --filter @arrakit/<pkg> test` runs one workspace. Tests that need a real Postgres run when
`DATABASE_URL` is set and are skipped otherwise.

## Make it yours

- The product's name, slug and npm scope, everywhere at once:
  `pnpm init:project --name "Acme Cloud" [--slug acme-cloud] [--scope acme] [--dry-run]`, then
  `pnpm install`. Run it before creating Stripe prices: they are found by a lookup key that starts
  with the slug, and the session cookie is named after it too.
- The rest of the brand: the texts in `apps/web/src/i18n/locales/*/*.json` (they take the name
  from `APP_NAME`), `apps/landing` and the icons in `apps/web/public` and `apps/landing/public`.
- The plans and their prices: `packages/plans/src/index.ts`, then the Stripe prices with
  `pnpm --filter @arrakit/api stripe:prices`.
- The product itself: its procedures in a contract file under `packages/contract/src` and a router
  under `apps/api/src/routers`, its tables in `packages/db/src/schema` (each with
  `organization_id`, reached through `forOrganization()`), its screens under
  `apps/web/src/components/<module>` with thin routes in `apps/web/src/routes/app`, and its MCP
  tools in `apps/api/src/mcp/server.ts`.
