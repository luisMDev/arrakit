What I would do next, by priority

1. A complete example "projects" module that sets the canonical pattern: schema, its scope in
   `forOrganization()` (or a generic tenancy guard), contract, router, MCP tool, a screen with
   react-hook-form, an entry in an extensible sidebar, and tests.
2. Make credits, storage + jobs, MCP/OAuth and billing optional. Drop the plans CHECK from the SQL.

Production

- No rate limiting shared across instances (Better Auth configures neither `rateLimit` nor
  `secondaryStorage`), and no audit log. The web has no full CSP (no `script-src`/`connect-src`;
  it would need nonces in TanStack Start and testing against Stripe).
- No admin panel, customer API keys, seed data or data export (GDPR).

Frontend

- The landing copy is written in `apps/landing/src/pages/index.astro` (still placeholder text) and
  the landing does not share the web's theme.
- The shell has no extensible navigation: the links are hard-coded in
  `apps/web/src/components/shell/app-menu.tsx`. The `sidebar` and `sheet` components are installed
  but unused, and there is no mobile navigation.

Starting a new product

- `pnpm init:project` renames the product name, slug and npm scope. Two of the renamed values are
  functional: the slug prefixes the session cookie (`COOKIE_PREFIX` in `packages/auth/src/config.ts`)
  and the Stripe price lookup keys (`PRICE_KEY_PREFIX` in `apps/api/src/billing/subscription-plan.ts`).
  Renaming after the prices exist means creating them again; the script warns about both.

Backend

- Tenancy by convention: there is no generic guard. `forOrganization()`
  (`packages/db/src/organization/index.ts`) exposes hand-written methods per domain, and isolation
  between organizations depends on every query filtering by `organizationId`.
- A new module touches many places (schema, scope, contract, router, screen, i18n, tests),
  including the hand-written MCP tools (`apps/api/src/mcp/server.ts`).
- Coupled product pieces:
  - Credits are part of every procedure's base contract: the `PAYMENT_REQUIRED` error with its
    metric in `packages/contract/src/common.ts`.
  - The plan's seat count is part of member management (`packages/auth/src/organization.ts`).
  - Plans are fixed by a SQL CHECK (`organizations_plan_check` in
    `packages/db/src/schema/organizations.ts`), so changing them needs a migration.
- Infrastructure without real use: file storage (`packages/db/src/storage`, tested, about 160
  lines without the tests) has no endpoint that uploads or reads files; only the purge worker uses
  it when an organization is deleted.
- Hard to remove: credits, MCP/OAuth (`createApp` in `apps/api/src/app.ts` always mounts the MCP
  routes; no setting turns them off) and, above all, multi-organization mode.
