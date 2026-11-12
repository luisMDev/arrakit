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
  to the local Supabase stack's Mailpit inbox (http://127.0.0.1:54324).
- **MCP server** at `/api/mcp`, with OAuth 2.1 sign-in through Better Auth's OAuth provider
  (Claude's custom connectors work with it) and one example tool, `whoami`.
- **Files** for the organization and for each workspace: browsers upload and download straight to
  a private Supabase Storage bucket through URLs the API signs after its checks; the plan sets the
  allowed types and the size limit, and stored bytes count against `storage_gb`. Uploads, renames
  and deletions publish durable events that background subscribers react to. The local stack
  holds the bucket in dev and e2e.
- **Jobs** with pg-boss on the same Postgres.
  Tracked jobs are **tasks** people follow in each workspace and in Settings: status, retries and
  progress, live as they change, with `task.succeeded` and `task.failed` events to react to. Each
  change is signalled through a private Supabase Realtime channel and the web reads the task from
  the API; the signal carries only the task's id.
- **Tenancy** enforced by Postgres: every table has row level security on, and every
  organization query and file key goes through `forOrganization(claims)` (a member, with the
  claims `claimsFor` builds from their permissions) or `asSystem(organizationId)` (server work) in
  `@arrakit/db`. The API connects as a privileged role and switches to `authenticated` with the
  caller's claims for each organization operation; the Supabase Data API stays off. ESLint
  refuses the database and storage drivers anywhere else.

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
  it is the `usage` module of the organization scope in `@arrakit/db`
  (`forOrganization(claims).usage`, or `asSystem(id).usage` for server work).

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
| `packages/db`       | Drizzle schema, tenancy, jobs (pg-boss), storage (Supabase Storage)   |
| `supabase`          | Local Supabase stack config and the SQL migrations                    |
| `packages/contract` | The oRPC contract (Zod) the API implements and the web calls          |
| `packages/auth`     | Better Auth setup (magic link, social, organizations, OAuth provider) |
| `packages/plans`    | Plans, prices, metrics and the usage arithmetic                       |
| `packages/address`  | Email, slug, organization-name and time-zone rules                    |
| `packages/emails`   | Email layout and templates                                            |

The layout, package boundaries and rules are in [AGENTS.md](AGENTS.md).

## Run it

Node 24 and pnpm 12 (`engines` and `packageManager` in `package.json`), and Docker for the local
Supabase stack.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm dev        # local Supabase stack, api :5000, web :5200 (/api proxied), landing :5321
```

`pnpm dev` starts the local Supabase stack (Postgres, its pooler, Realtime, Studio at
http://127.0.0.1:54323 and a Mailpit inbox) and applies the migrations in `supabase/migrations`;
`.env.example` points `DATABASE_URL` at it. `pnpm supabase:stop` stops it and `pnpm db:reset`
recreates its database (restart the API after a reset: pg-boss creates its schema on boot).
Starting the stack also writes the git-ignored `apps/api/.env.stack`: a Better Auth signing key
made for this clone (`BETTER_AUTH_JWT_KEY`), where the stack's Realtime and Storage answer
(`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`) and the server-only `SUPABASE_SECRET_KEY` for the
`files` bucket (without it uploads are kept in memory). The key's public half is listed in the git-ignored
`supabase/signing_keys.json`, so the stack trusts the tokens the API signs; when that file
changes (the first start, or after deleting it) the stack is stopped and started once. `pnpm dev`
loads `.env` and then `.env.stack`, and the e2e API loads `.env.stack` too; the key does not live
in the database, so it survives `pnpm db:reset`.
Without `RESEND_API_KEY` mail goes to Mailpit (`MAILPIT_URL`), or to the console when that is
unset, and with `STRIPE_FAKE=1` Stripe is faked. In production set `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`/`WEB_URL` (the web origin), `RESEND_API_KEY` and
`MAIL_FROM`, the `STRIPE_*` keys, and `SUPABASE_URL` with `SUPABASE_SECRET_KEY` (server only) for
files. The bucket and its limits come from `supabase/config.toml` through
`supabase seed buckets`. Migrations are applied with the Supabase CLI, not on boot: the API refuses to
start on a database that is behind. For live task updates set `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY` (without them the web reads the task lists on a timer); the browser
learns both from the API. Supabase must trust Better Auth's signing key: a Custom OIDC
third-party auth integration with the issuer `<web origin>/api/auth` (the hosted checklist comes
with the last phase of the Supabase migration). The web reads `API_ORIGIN`, `VITE_APP_NAME` and
`VITE_SITE_URL`.

With real Stripe keys, create the products and prices once:
`pnpm --filter @arrakit/api stripe:prices`. The OpenAPI document of the API is written by
`pnpm --filter @arrakit/api openapi:export <file>`.

## Check it

```bash
pnpm typecheck
pnpm lint
pnpm test       # Vitest: unit, API integration on PGlite, React Testing Library
pnpm test:e2e   # Playwright: boots the api (local Supabase stack, fake Stripe) and the web
pnpm format:check
```

`pnpm --filter @arrakit/<pkg> test` runs one workspace. Tests that need a real Postgres run when
`DATABASE_URL` is set and are skipped otherwise; the Storage tests run against the local stack
when `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `SUPABASE_PUBLISHABLE_KEY` are set (all three are
in `apps/api/.env.stack`).

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
  `organization_id` and tenant policies, reached through the organization scope), its screens under
  `apps/web/src/components/<module>` with thin routes in `apps/web/src/routes/app`, and its MCP
  tools in `apps/api/src/mcp/server.ts`.
