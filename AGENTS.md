# AGENTS.md — Arrakit

Read this file first. It is the source of truth for the repository layout, the stack and the rules.

## Goal

Arrakit is a clone of the **features and screens** of `saas-base` (NestJS + Angular + Nx, at
`/home/luismdev/Projects/saas-base`) rebuilt on a new stack. We migrate **functionality, not
style**: every saas-base feature must exist in Arrakit, but screens are built from scratch with
**shadcn/ui and its default theme**. Do not port saas-base CSS, DaisyUI classes, fonts or
components. Copy (i18n texts) is reused from saas-base.

The detailed, authoritative behaviour of every feature is in `docs/spec/*.md` (see "Features").
When a spec and this file disagree on layout or tooling, this file wins; on behaviour, the spec wins.

## Stack

| Area     | Choice                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo | pnpm workspaces + Turborepo (Node 24, pnpm 12)                                                                                         |
| Web app  | React 19 + TanStack Start (file-based routing, TanStack Router + TanStack Query), Nitro                                                |
| UI       | Tailwind CSS v4 + shadcn/ui (default theme, Radix primitives, lucide icons), sonner                                                    |
| i18n     | i18next + react-i18next, `en` (bundled, fallback) and `es` (lazy)                                                                      |
| API      | Hono on Node (`@hono/node-server`) + oRPC (contract-first, `@orpc/contract`) + Zod 4                                                   |
| DB       | Postgres + Drizzle ORM (drizzle-kit migrations); PGlite when `DATABASE_URL` is unset                                                   |
| Auth     | Better Auth (magic link, Google, Microsoft, organization plugin with teams and custom roles, OAuth provider + JWT, 5-min cookie cache) |
| Payments | Stripe (`stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js`), fake gateway in dev                                                 |
| Email    | Resend in production; Mailpit (local inbox) in dev and e2e; recording mailer in tests                                                  |
| Jobs     | pg-boss on Postgres; in-process runner with the same interface on PGlite                                                               |
| Logs     | Pino (JSON lines; pino-pretty in dev), request id per request; Sentry (`@sentry/node`)                                                 |
| Files    | S3-compatible storage (`@aws-sdk/client-s3`); local/in-memory fallback in dev/tests                                                    |
| MCP      | `@modelcontextprotocol/server` (v2, stateless Streamable HTTP) behind Better Auth OAuth                                                |
| Landing  | Astro (static) + Tailwind                                                                                                              |
| Tests    | Vitest, React Testing Library, Better Auth `testUtils` plugin, PGlite, Playwright                                                      |
| Lint/fmt | ESLint 10 flat config (typescript-eslint) + Prettier                                                                                   |
| Types    | TypeScript 6.0 (typescript-eslint does not support 7 yet; do not upgrade)                                                              |

## Code comments

- Express intent through names, types and small functions; the code itself is the documentation.
- Default to zero comments. Add one only when logic is genuinely complex or a constraint is invisible from the code (a workaround, an external limitation).
- Comments describe the code as it is now. Never reference tickets, tasks, past versions, decisions or what you just changed — that belongs in commits and PRs.
- When an edit makes an existing comment inaccurate, delete it.
- Tool directives (eslint-disable, @ts-expect-error) and license headers are fine.

## Repository layout

```
apps/
  web/          @arrakit/web      TanStack Start app (port 5200). shadcn/ui lives here.
    src/routes/                   thin file routes: guard + search validation + title + one component
                                  (routeTree.gen.ts is generated, do not edit)
    src/components/ui/            shadcn/ui components (generated, keep as shadcn ships them)
    src/components/<module>/      screens per module: auth, onboarding, organizations, settings,
                                  billing, usage, shell, oauth (settings/ holds one file per section)
    src/lib/orpc.ts               typed oRPC client + TanStack Query utils (`orpc.x.y.queryOptions()`)
    src/lib/auth-client.ts        Better Auth React client (`@arrakit/auth/client`)
    src/lib/guards/               route guards: require-user, require-account, skip-when-signed-in
    src/lib/                      statusOf()/reportError()/apiMessage(), format, notify, useCurrentUser(), titled(), checkoutChoice(),
                                  useClearingForm()/registerClearing() (form errors hide while a field is edited)
    src/i18n/                     i18next setup, `tr()`, `loadLanguage()`;
                                  locales/{en,es}/<module>.json deep-merged into one namespace
    src/start.ts                  createStart({ defaultSsr: false }): screens render in the browser
    src/config.ts                 APP_NAME, SITE_URL (one place to rebrand the web)
    e2e/                          Playwright specs (playwright.config.ts boots api + web)
  api/          @arrakit/api      Hono server (port 5000)
    src/app.ts                    createApp(deps): mounts routes/* and the oRPC router at /api/rpc,
                                  refusing (403) any non-GET RPC call whose Origin is not trusted
    src/router.ts                 root oRPC router composing routers/<module>.ts
    src/routers/                  one oRPC router per module (implements its contract file)
    src/orpc/base.ts              builders: pub, authed, member(permissions?)
    src/orpc/context.ts           BaseContext {deps, headers, log}, procedureContext(); reportErrors
                                  (maps DomainError and Better Auth APIError to ORPCError, logs and
                                  reports unexpected errors); requireSession, requireMember(permissions?)
                                  (membership in the session's active organization, read fresh);
                                  MemberContext adds {user, session, activeOrganization, role,
                                  permissions, scope}
    src/organizations/            organizationDeps() (what the Better Auth organization plugin's rules
                                  need: seats, Stripe end, grants, purge) + its integration tests
    src/routes/                   plain Hono routes: health, auth (+ OAuth metadata), stripe-webhook,
                                  mcp (+ protected-resource metadata)
    src/services.ts               buildDeps()/depsFromEnv(): AppDeps (env, data, auth, mailer, stripe)
    src/env.ts                    Zod env parsing (loadApiEnv)
    src/mail/mailer.ts            createMailer (Resend / Mailpit / console), recordingMailer()
    src/billing/                  StripeGateway interface + createStripeGateway (unconfigured / fake /
                                  real); guardedStripe() maps every Stripe failure to 402 or 502 once
    src/usage/                    requiresUsage() middleware
    src/workers/                  background workers; workers/index.ts registers them at boot
    src/mcp/                      MCP server factory
    src/observability/            createLogger() (Pino), requestLog() (X-Request-Id + access line),
                                  createErrorReporter() (Sentry or none), isUnexpected()/reportUnexpected()
    src/testing/                  createTestApp() (in-process app on PGlite + testUtils), fake Stripe
    src/main.ts                   boot (logger, env, error reporter, mailer, openData, workers, serve,
                                  graceful shutdown)
    scripts/                      operational scripts (Stripe prices, credits product)
  landing/      @arrakit/landing  Astro static site (port 5321)
packages/
  db/           @arrakit/db       Drizzle + Postgres/PGlite. ./drizzle holds the migrations.
    src/schema/                   complete schema, one file per domain (auth, organizations, oauth, usage)
    src/open-data.ts              openData(config): connect, migrate, storage, jobs -> Data facade
    src/data/<domain>.ts          non-scoped data functions (membership, organizations (grants),
                                  invitations, account)
    src/organization/             forOrganization(id): tenant-db guard + one scope file per domain
                                  (organization, billing, members, roles, teams, usage, storage)
    src/jobs/, src/storage/       Jobs (pg-boss / in-process / memory), Storage (S3 / local / memory)
    src/testing.ts                `@arrakit/db/testing`: openTestData() (in-memory PGlite, migrated)
  auth/         @arrakit/auth     createAuth(deps) (Better Auth + plugins; one file per concern: hooks,
                                  magic-link, social, oauth, organization (+ organization-policy)),
                                  loadAuthConfig(); `./client` (React client with organizationClient);
                                  `./permissions` (pure access control shared with the web: statements,
                                  ac, roles, permissionsOf, allows). The DB adapter is injected.
  contract/     @arrakit/contract oRPC contract, one file per module + common.ts; index.ts composes them
  plans/        @arrakit/plans    Pure plans catalog (catalog.ts) and usage arithmetic (usage.ts)
  address/      @arrakit/address  Pure email/slug/org-name/time-zone/device-name/language rules, one file each
  emails/       @arrakit/emails   Mail/Mailer types, composeEmail layout, copy helpers, one file per
                                  template in templates/, APP_NAME brand
  tsconfig/     @arrakit/tsconfig Shared tsconfig presets: base.json, node.json, react.json
  eslint-config/@arrakit/eslint-config  Flat config: base(), react(), data-import guard
docs/spec/      Feature specs (read the one for your area before coding)
docs/ownership.md  Which files each feature module owns (parallel work without collisions)
```

### Package boundaries (enforced)

- **Only `packages/db` imports** `drizzle-orm`, `drizzle-kit`, `pg`, `pg-boss`, `@electric-sql/pglite`
  and `@aws-sdk/*`. Everyone else (apps/api included) goes through `openData()` /
  `forOrganization(id)` from `@arrakit/db`. ESLint `no-restricted-imports` enforces it
  (`@arrakit/eslint-config` → `base()`); packages/db opts out with `base({ restrictData: false })`.
- `packages/contract` is the only place where procedure inputs/outputs are declared. The API
  implements it with `implement(contract)`; the web consumes it through `#/lib/orpc`.
- `packages/plans`, `packages/address`, `packages/emails` are pure (no I/O, no framework), usable from web and api.
- The web never talks to the database or Stripe secrets; it only calls `/api/*`.
- Internal packages ship TypeScript source (`"exports": { ".": "./src/index.ts" }`); there is no
  per-package build. The API is bundled with tsdown (workspace packages inlined); the web with Vite.
- Workspace imports: `@arrakit/<name>`. Inside apps/web use the `#/` alias for `src/` (e.g. `#/components/ui/button`).

### shadcn/ui

shadcn components live in **`apps/web/src/components/ui`** (single consumer, so no `packages/ui`).
All components the product needs are already installed (button, card, input, label, form, field,
dialog, alert-dialog, dropdown-menu, select, tabs, table, badge, avatar, sonner, separator,
skeleton, switch, radio-group, tooltip, sheet, sidebar, progress, alert, popover, command,
checkbox, textarea, scroll-area, breadcrumb, collapsible, hover-card, toggle, toggle-group,
pagination, input-otp, spinner, empty, item, button-group, kbd, navigation-menu). Forms use
`react-hook-form` + `@hookform/resolvers/zod` (`#/lib/form` for errors that clear while editing). Theme: shadcn default (`src/styles.css`); do not restyle.
`<TooltipProvider>` and `<Toaster />` are mounted in `src/routes/__root.tsx`.

If you ever need another component: `cd apps/web && pnpm dlx shadcn@latest add <name>`, then
replace any `from "cn"` import it writes with `from "#/lib/utils"` (the CLI mis-resolves the `#/` alias)
and remove the stray `cn` dependency if it was added.

## Dependencies

**Every dependency the product needs is already installed. Do not run `pnpm add`/`pnpm remove`**
(agents work in parallel; lockfile edits collide). If something is truly missing, stop and report it.
Highlights per workspace:

- api: hono, @hono/node-server, @orpc/server, @orpc/contract, @orpc/zod, @orpc/client,
  zod, better-auth, @better-auth/oauth-provider, stripe, resend, @modelcontextprotocol/server
  (+ @modelcontextprotocol/sdk, and @modelcontextprotocol/client for tests), croner, tsx, tsdown.
  The api also lists drizzle-orm, pg, pg-boss, @electric-sql/pglite and @aws-sdk/* only so the
  tsdown bundle keeps them external at runtime; its source still may not import them (lint).
- db: drizzle-orm, drizzle-kit, pg, @types/pg, @electric-sql/pglite, pg-boss, @aws-sdk/client-s3,
  @aws-sdk/s3-request-presigner, better-auth (drizzle adapter), croner, zod.
- auth: better-auth, @better-auth/oauth-provider, zod, @arrakit/emails (dev: @arrakit/db for tests).
- contract: @orpc/contract, zod, @arrakit/plans, @arrakit/auth, @arrakit/address.
- web: @tanstack/react-start, @tanstack/react-router, @tanstack/react-query, @orpc/client,
  @orpc/tanstack-query, better-auth, i18next, react-i18next, sonner, @stripe/stripe-js,
  @stripe/react-stripe-js, react-hook-form, @hookform/resolvers, zod, lucide-react, radix-ui;
  dev: vitest, jsdom, @testing-library/{react,dom,user-event,jest-dom}, msw, @playwright/test.
- landing: astro, @astrojs/sitemap, tailwindcss, @tailwindcss/vite.

## Commands

Run from the repo root.

| Command                                      | What it does                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm install`                               | Install                                                                 |
| `pnpm dev`                                   | api (5000) + web (5200) + landing (5321)                                |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Turborepo across all workspaces                                         |
| `pnpm build`                                 | Build web (`.output`), api (`dist`), landing (`dist`)                   |
| `pnpm test:e2e`                              | Playwright (apps/web) against api + web on PGlite                       |
| `pnpm --filter @arrakit/<pkg> test`          | One workspace's tests                                                   |
| `pnpm --filter @arrakit/db db:generate`      | Generate a Drizzle migration from the schema                            |
| `pnpm --filter @arrakit/api stripe:prices`   | Create/align the Stripe products and prices (needs `STRIPE_SECRET_KEY`) |
| `pnpm --filter @arrakit/api stripe:credits`  | Create/align only the Credits top-up price                              |
| `pnpm format`                                | Prettier                                                                |

## Conventions

- The web `typecheck` script is plain `tsc --noEmit`: `routeTree.gen.ts` is regenerated by the
  Vite plugin (`pnpm dev` / `pnpm build`), not by the `tsr` CLI (which drops the Start `Register` block).
- **English** for code, comments, docs, commit messages. UI copy comes from the locale files.
- **Tests are required** for every feature: unit tests for pure logic, integration tests for API
  procedures (PGlite), component tests for screens (RTL), and the end-to-end flows in the specs
  (Playwright). Port the saas-base tests listed in each spec.
- **Tenancy rule**: every table except the named exceptions (users, sessions, accounts,
  verifications, organizations, OAuth/JWT tables, team_members; see `docs/spec/platform.md` 2.10) has
  `organization_id uuid not null references organizations(id) on delete cascade`, and
  organization data is only reached through `forOrganization(orgId)`.
- **i18n rule**: no hard-coded user-facing strings in the web app. Use `useTranslation()` /
  `t('ns.key')` in components and `tr()` outside React. Keys live in
  `apps/web/src/i18n/locales/{en,es}/<module>.json` (common, shell, auth, onboarding,
  organizations, members, settings, billing, usage, oauth; imported from saas-base with "SaaS" →
  "Arrakit"). The files are deep-merged into one namespace, so a key reads the same wherever it
  lives (`t('settings.membersSettings.title')` is in members.json). Each module edits only its
  own files; `en` and `es` must keep identical key sets and no key may be defined twice (tests).
- **Contract first**: add the procedure to `packages/contract`, implement it in apps/api, consume
  it in apps/web via `orpc.<ns>.<proc>.queryOptions()` / `.mutationOptions()`.
- **Toasts**: only through `notify.success/warning/error` from `#/lib/notify` (same text never
  stacks; errors and warnings stay 6 s). Importing `sonner` anywhere else in the web is a lint error.
  Failed queries and mutations are reported and toasted once by the query client
  (`QueryCache`/`MutationCache` `onError` in `integrations/tanstack-query/root-provider.tsx`): the
  API's own message (`apiMessage()` in `#/lib/api-errors`) or the operation's `meta.failure` text;
  a 401 is silent. A screen calls the API through `useApiMutation(options)` from
  `#/lib/use-api-mutation` (`run()` guards against a double submit; `busy` = pending or done).
  Money and days are written with `#/lib/format` (active language).
- Errors from procedures use oRPC errors (`ORPCError`) with HTTP-meaningful codes (400/401/403/404/409/402).
- **Logging (api)**: never `console.*`. Procedures log through `context.log`, Hono routes through
  `c.get('log')` (both carry the request id), the rest through `deps.log` or an injected `Logger`;
  `packages/db` takes a `DataLog` in `openData(config, { log })`. Put data in fields and the error
  under `err`, with a constant message: `log.error({ err, organizationId }, 'invite email not sent')`.
  Anything that is not an `ORPCError` (or is a 500) is logged and sent to Sentry by `app.onError`
  and the `reportErrors` middleware on `pub` (`orpc/base.ts`); deliberate refusals are not.
- Product name: `APP_NAME` in `apps/web/src/config.ts`, `packages/emails` and `apps/landing/src/lib/config.ts`.
- Use shadcn components and Tailwind utility classes only; no custom design system.
- Never `git push`. Commit only when asked.

## HTTP layout and proxy

- API (Hono): `GET /health`, `/api/auth/*` (Better Auth), `/api/rpc/*` (oRPC only: no REST or
  OpenAPI), `POST /api/webhooks/stripe`, `/api/mcp`, `/.well-known/oauth-*`. Unknown → 404.
  A non-GET `/api/rpc/*` call from an untrusted Origin answers 403 "Use the app." (CSRF guard).
- Web and API must be **one site** so the Better Auth cookie is first-party (`BETTER_AUTH_URL` =
  web origin). The web server proxies `/api/**` and `/.well-known/oauth-*/**` to `API_ORIGIN`
  in dev and in the production build. Vite's `server.proxy` is NOT used (the TanStack
  Start/Nitro middleware answers first). A Nitro handler (`apps/web/src/server/api-proxy-handler.ts`,
  registered in `apps/web/vite.config.ts` for `apiProxiedPaths`) reads `API_ORIGIN` per request,
  sets `xfwd`, drops the incoming `x-forwarded-for` and sends one client IP (`cf-connecting-ip`
  when present, else the TCP peer); `x-real-ip` passes through.
- Mail in dev and e2e goes to Mailpit (`MAILPIT_URL`, HTTP send API) when `RESEND_API_KEY` is
  unset. `pnpm dev` starts it through `scripts/mailpit.sh` (inbox at http://localhost:5025);
  the script uses `mailpit` from PATH or downloads the pinned release into `.data/bin`.

## Testing strategy

- **Vitest** everywhere (`vitest run`); node environment for packages/api, jsdom for web
  (`apps/web/src/test/setup.ts` loads jest-dom matchers and RTL cleanup).
- **Timeouts**: PGlite migrations are slow when every workspace runs at once, so the node
  Vitest configs (db, auth, api) use `testTimeout: 30s` / `hookTimeout: 60s`, and the web setup
  raises RTL's `asyncUtilTimeout` to 5 s and stubs `ResizeObserver` globally (Radix).
- **Database**: PGlite in-memory per test file (Docker is not available).
  `import { openTestData } from '@arrakit/db/testing'` opens a migrated in-memory `Data` with
  memory storage and the recording `memoryJobs()` fake (`data.jobs.sent`, `sentJobs()`).
- **Auth**: Better Auth `testUtils` plugin (`import { testUtils } from 'better-auth/plugins'`),
  enabled only in tests. `const { test } = await auth.$context` then `test.createUser()`,
  `test.saveUser()`, `test.login({ userId })` → `{ headers, cookies, session, user }`,
  `test.getAuthHeaders()`, `test.getOTP()` (with `captureOTP`). Use those
  headers when calling `app.request()` / the oRPC client against `createApp()` in-process.
  (`@better-auth/test-utils` on npm is for adapter conformance, not for this.)
- **API integration**: `const t = await createTestApp()` (`apps/api/src/testing/app.ts`) builds the
  whole app in-process: `t.signIn({ email })` → `{ headers, userId }` (session cookie + trusted
  Origin, via testUtils), `t.client(headers).me.get()`, `t.app.request(...)`, `t.sent` (recorded
  mail), `t.logs` (parsed log entries), `t.errorLog()` (error entries from now on), `t.captured`
  (errors sent to the tracker), `t.context(headers)` (a procedure context for `call()`), `t.data`,
  `t.close()`. `t.client()` sends the app's Origin unless the headers carry one; `ownerOf()` /
  `joinAs()` / `joined()` in `testing/people.ts` put people in organizations, and `orgApi(t, headers)`
  calls the organization plugin over HTTP (`.post('invite-member', body)`, `.get('list-teams', query)`). Pass
  `{ stripe: fakeStripe() }` for billing (without it Stripe is unconfigured: 503). Note: when the
  Microsoft provider is configured, Better Auth's `validateUserInfo` makes `testUtils.saveUser()`
  require an endpoint context, so create such users through the API.
- **Web components**: React Testing Library + user-event; mock the API with msw or by injecting a client.
  `#/test/rpc` holds the shared kit: `api` (msw server), `answer(path, ...replies)`, `rpcError()`,
  `meAs()`, `renderAt(ui, { me, url })` (router + query client + toaster), `withQueries()`, `quiet()`.
- **E2E**: Playwright in `apps/web/e2e`; `playwright.config.ts` boots the API on port 5100 with a
  throwaway PGlite dir (`.data/e2e-pglite-<api port>`, reset at boot), `STRIPE_FAKE=1`,
  `NODE_ENV=test`, mail sent to a Mailpit on 5125, and the web dev server on 5200. Specs import `WEB_ORIGIN` from `e2e/origins.ts`;
  set `E2E_API_PORT` / `E2E_WEB_PORT` / `E2E_MAILPIT_PORT` to run a second suite side by side (running servers on the
  same ports are reused outside CI). Embedded Checkout cannot load with the fake gateway's client
  secret, so e2e asserts reaching `/app/checkout` and drives payments through the fake webhook.
  Read magic links with `magicLinkFor(request, email)` from `e2e/mailpit.ts` (newest mail first;
  `clearMailFor` deletes an address's mail). Chromium is installed
  (`pnpm --filter @arrakit/web exec playwright install chromium`).

## Features (specs)

| Area                      | Spec                                                                     | Summary                                                                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth and onboarding       | [docs/spec/auth-onboarding.md](docs/spec/auth-onboarding.md)             | Better Auth config, magic link, Google, Microsoft, sessions and permission middleware, `me.get`, profile onboarding (create org / skip), signup/signin screens, guards, Unavailable, MailSignin, proxy, i18n                                                              |
| Organizations and members | [docs/spec/organizations-members.md](docs/spec/organizations-members.md) | Better Auth organization plugin: several organizations per person, active organization, rename/delete, roles, custom roles, teams, member change policy, invitations, join page, Settings > Account, account deletion, settings shell, `forOrganization`                  |
| Billing and plans         | [docs/spec/billing-plans.md](docs/spec/billing-plans.md)                 | Plans catalog, Stripe gateway + fake, subscription events, Embedded Checkout, billing view, plan/cycle change with preview, cancel/resume, portal, webhook, billing emails, /pricing, /app/plans, /app/checkout, /app/welcome, Settings > Billing, price bootstrap script |
| Usage and credits         | [docs/spec/usage-credits.md](docs/spec/usage-credits.md)                 | Metrics catalog, credit ledger, usage levels, `requiresUsage` middleware and 402, `usage.get`, top-ups via Checkout, refunds/disputes, Settings > Usage, Add credits dialog, credits product script                                                                       |
| Platform                  | [docs/spec/platform.md](docs/spec/platform.md)                           | Full Drizzle schema, `openData` (Postgres/PGlite), tenancy guard, jobs, file storage + purge worker, `/health`, mailer + templates, OAuth 2.1 server, MCP `/api/mcp` with `whoami`, `/oauth/signin`, `/oauth/consent`, API boot                                           |
| Web shell and landing     | [docs/spec/web-shell-landing.md](docs/spec/web-shell-landing.md)         | Root layout, route table, `requireUser`, signed-in shell + account menu, Home, Welcome, Unavailable, i18n live switching, API/toast helpers, stale chunk recovery, Astro landing                                                                                          |

## Make it yours

- Product name: `APP_NAME` (web config, emails brand, landing config), locale texts, icons in
  `apps/web/public` and `apps/landing/public`.
- Plans and prices: `packages/plans`, then `apps/api/scripts/stripe-prices.ts`.
- A new product module: procedures in `packages/contract`, router in `apps/api`, tables in
  `packages/db` schema (with `organization_id`, reached only through `forOrganization()`),
  screens under `apps/web/src/routes/app/`, MCP tools in the API's MCP tools file.

## Astro (apps/landing)

`astro dev --background` runs the dev server in the background; manage it with
`astro dev stop|status|logs`. Docs: https://docs.astro.build
