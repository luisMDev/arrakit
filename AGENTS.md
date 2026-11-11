# AGENTS.md — Arrakit

Read this file first. It holds the stack and the rules; the code and its tests hold everything else.

## Goal

Arrakit is a multi-tenant SaaS starter: sign-in (magic link, Google, Microsoft), organizations
with members, roles and teams, Stripe billing, usage credits, an OAuth 2.1 server with MCP, and a
static landing. Screens use **shadcn/ui with its default theme**.

Behaviour is defined by the tests, not by prose. Before changing a feature, read its tests
(unit, API integration, component and e2e); when the behaviour changes, change the tests with it.
Do not write spec or design documents: like comments, they drift because nothing checks them.
For the same reason, keep this file to rules: no file inventories, helper lists or line numbers.

## Stack

| Area     | Choice                                                                                 |
| -------- | -------------------------------------------------------------------------------------- |
| Monorepo | pnpm workspaces + Turborepo                                                            |
| Web app  | React + TanStack Start (file-based routing, TanStack Router + TanStack Query), Nitro   |
| UI       | Tailwind CSS + shadcn/ui (default theme, Radix primitives, lucide icons), sonner       |
| i18n     | i18next + react-i18next, `en` (bundled, fallback) and `es` (lazy)                      |
| API      | Hono on Node + oRPC (contract-first) + Zod                                             |
| DB       | Postgres + Drizzle ORM (drizzle-kit migrations); PGlite when `DATABASE_URL` is unset   |
| Auth     | Better Auth (magic link, social providers, organization plugin, OAuth provider + JWT)  |
| Payments | Stripe, with a fake gateway in dev and tests                                           |
| Email    | Resend in production; Mailpit (local inbox) in dev and e2e; recording mailer in tests  |
| Jobs     | pg-boss on Postgres, or on the PGlite instance Drizzle uses                            |
| Logs     | Pino (JSON lines), request id per request; Sentry                                      |
| Files    | S3-compatible storage, presigned uploads; RustFS in dev and e2e; in-memory in tests    |
| MCP      | `@modelcontextprotocol/server` (stateless Streamable HTTP) behind Better Auth OAuth    |
| Landing  | Astro (static) + Tailwind                                                              |
| Tests    | Vitest, React Testing Library, Better Auth `testUtils` plugin, PGlite, msw, Playwright |
| Lint/fmt | ESLint flat config (typescript-eslint) + Prettier                                      |
| Types    | TypeScript 6 (typescript-eslint does not support 7 yet; do not upgrade)                |

Exact versions live in the `package.json` files.

## Code comments

- Express intent through names, types and small functions; the code itself is the documentation.
- Default to zero comments. Add one only when logic is genuinely complex or a constraint is invisible from the code (a workaround, an external limitation).
- Comments describe the code as it is now. Never reference tickets, tasks, past versions, decisions or what you just changed — that belongs in commits and PRs.
- When an edit makes an existing comment inaccurate, delete it.
- Tool directives (eslint-disable, @ts-expect-error) and license headers are fine.

## Repository layout

```
apps/web        TanStack Start app; the only home of shadcn/ui
apps/api        Hono server: Better Auth, the oRPC router, webhooks, MCP
apps/landing    Astro static site
packages/*      Shared workspaces (db, auth, contract, plans, address, emails, tsconfig, eslint-config)
docs/next-steps.md  Known gaps and the prioritised backlog
```

- Web: file routes stay thin (guard, search validation, title, one component); screens live in
  `src/components/<module>/`; `src/components/ui/` and `routeTree.gen.ts` are generated, do not edit.
- API: one oRPC router per module, implementing that module's contract.

### Package boundaries (enforced by lint)

- **Only `packages/db`** imports the database, queue and storage drivers (Drizzle, pg, pg-boss,
  PGlite, the S3 SDK). Everyone else, apps/api included, goes through `@arrakit/db`.
- `packages/contract` is the only place where procedure inputs and outputs are declared; the API
  implements it and the web consumes it through the typed oRPC client.
- `plans`, `address` and `emails` are pure (no I/O, no framework), usable from web and api.
- The web never talks to the database or holds secrets; it only calls `/api/*`.
- Internal packages ship TypeScript source; there is no per-package build.
- Workspace imports: `@arrakit/<name>`. Inside apps/web use the `#/` alias for `src/`.

### shadcn/ui

Components live in `apps/web/src/components/ui`, kept as shadcn ships them. Forms use
`react-hook-form` + Zod. Theme: shadcn default; do not restyle.

To add a component: `cd apps/web && pnpm dlx shadcn@latest add <name>`, then replace any
`from "cn"` import it writes with `from "#/lib/utils"` (the CLI mis-resolves the `#/` alias) and
remove the stray `cn` dependency if it was added.

## Dependencies

Do not run `pnpm add`/`pnpm remove` (agents work in parallel; lockfile edits collide). If something
is truly missing, stop and report it.

## Commands

Run from the repo root; the scripts in `package.json` are the full list.

| Command                                      | What it does                                 |
| -------------------------------------------- | -------------------------------------------- |
| `pnpm install`                               | Install                                      |
| `pnpm dev`                                   | api + web + landing (and Mailpit, RustFS)    |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Turborepo across all workspaces              |
| `pnpm build`                                 | Build web, api and landing                   |
| `pnpm test:e2e`                              | Playwright against api + web on PGlite       |
| `pnpm --filter @arrakit/<pkg> <script>`      | One workspace's script                       |
| `pnpm --filter @arrakit/db db:generate`      | Generate a Drizzle migration from the schema |
| `pnpm format`                                | Prettier                                     |
| `pnpm init:project --name "<Product>"`       | Rename product name, slug and npm scope      |

## Conventions

- The web `typecheck` script is plain `tsc --noEmit`: `routeTree.gen.ts` is regenerated by the
  Vite plugin (`pnpm dev` / `pnpm build`), not by the `tsr` CLI (which drops the Start `Register` block).
- **English** for code, comments, docs and commit messages. UI copy comes from the locale files.
- **Tests are required** for every feature: unit tests for pure logic, integration tests for API
  procedures (PGlite), component tests for screens (RTL), and end-to-end tests for the main
  journeys (Playwright).
- **Tenancy**: every table, except the named exceptions in the schema (a test enforces it), has
  `organization_id uuid not null references organizations(id) on delete cascade`, and
  organization data is only reached through `forOrganization(orgId)`.
- **i18n**: no hard-coded user-facing strings in the web app. Keys live in per-module locale files
  for `en` and `es`, deep-merged into one namespace; both languages keep identical key sets and no
  key is defined twice (tests).
- **Contract first**: add the procedure to `packages/contract`, implement it in apps/api, consume
  it in apps/web through the oRPC TanStack Query utils.
- **Toasts** go only through the web's `notify` helper; importing `sonner` anywhere else is a lint
  error. The query client reports and toasts failed queries and mutations once, so screens do not
  toast API errors themselves.
- Procedures fail with `ORPCError` and HTTP-meaningful codes (400/401/402/403/404/409).
- **Logging (api)**: never `console.*`; use the request-scoped logger from the context. Put data in
  fields and the error under `err`, with a constant message:
  `log.error({ err, organizationId }, 'invite email not sent')`. Unexpected errors are logged and
  sent to Sentry centrally; deliberate refusals are not.
- Product name: `APP_NAME` (web, emails and landing each define it).
- Use shadcn components and Tailwind utility classes only; no custom design system.
- Never `git push`. Commit only when asked.

## HTTP and proxy

- The API serves only `/health`, `/api/auth/*` (Better Auth), `/api/rpc/*` (oRPC; no REST or
  OpenAPI), the Stripe webhook, `/api/mcp` and `/.well-known/oauth-*`. Non-GET RPC calls from an
  untrusted Origin are refused (CSRF guard).
- Web and API must be **one site** so the Better Auth cookie is first-party (`BETTER_AUTH_URL` is
  the web origin). The web server (Nitro) proxies the API paths to `API_ORIGIN`, read per request,
  in dev and in the production build; Vite's `server.proxy` is not used because the Start/Nitro
  middleware answers first.
- Both servers send security headers; OAuth and MCP paths stay readable cross-origin, and proxied
  responses keep the API's headers.
- Mail in dev and e2e goes to Mailpit when `RESEND_API_KEY` is unset; `pnpm dev` starts it.
- Files in dev and e2e go to a local RustFS (`pnpm rustfs`, started by `pnpm dev`). Browsers upload
  and download straight to the bucket through presigned URLs, never through the API, so a
  production bucket needs a CORS rule allowing PUT and GET from the web origin.

## Testing

- **Vitest** everywhere: node environment for packages and api, jsdom for web.
- **Database**: in-memory PGlite per test file (Docker is not available), through `@arrakit/db/testing`.
- **Auth**: Better Auth's `testUtils` plugin, enabled only in tests. (`@better-auth/test-utils` on
  npm is for adapter conformance, not for this.)
- **Shared kits**: the API, the web and the e2e suite each have a testing kit (in-process app,
  people helpers, msw answers, render helpers, Mailpit readers). Read it and reuse it before
  writing a new helper.
- **E2E**: Playwright boots the API on PGlite with fake Stripe, Mailpit and RustFS, plus the web
  dev server. Embedded Checkout cannot load with the fake gateway's client secret, so e2e asserts
  reaching the checkout page and drives payments through the fake webhook.

## Make it yours

- Product name, slug and npm scope: `pnpm init:project` (`scripts/init.ts`), before creating
  Stripe prices. Then locale texts and the icons in each app's `public/`.
- Plans and prices: `packages/plans`, then the API's Stripe prices script.
- A new product module: follow the `workspaces` module end to end. Tables in the `packages/db`
  schema (with `organization_id`, reached only through `forOrganization()`), a permission resource
  in `@arrakit/auth/permissions`, procedures in `packages/contract`, a router in apps/api, MCP
  tools in the API's MCP server, screens in apps/web with an entry in the app's navigation list,
  and tests at every layer.
- Reacting to files (indexing, emails, previews): add a file subscriber to the API's subscriber
  list. File events are published in the same transaction as the change, and each subscriber
  gets its own retried queue; do not call follow-up work from the files router.
- File types and size limits per plan: `packages/plans` (the API enforces them, the web
  pre-checks them).
- Background work people follow as tasks: declare it with `defineTrackedJob` in the API's
  tracked job list, start it with `startTask` (the task and its job commit together), report
  progress from the handler and throw `TaskError` for a failure retrying cannot fix. Give its kind
  and error codes copy under `tasks.kinds` and `tasks.errors`. React to a task finishing with
  a task subscriber (`task.succeeded`, `task.failed`), not from the handler.

## Astro (apps/landing)

`astro dev --background` runs the dev server in the background; manage it with
`astro dev stop|status|logs`. Docs: https://docs.astro.build
