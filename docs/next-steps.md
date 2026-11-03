What I would do next, by priority

1. Make credits, storage + jobs, MCP/OAuth and billing optional. Drop the plans CHECK from the SQL.

Production

- No rate limiting shared across instances (Better Auth configures neither `rateLimit` nor
  `secondaryStorage`), and no audit log. The web has no full CSP (no `script-src`/`connect-src`;
  it would need nonces in TanStack Start and testing against Stripe).
- No admin panel, customer API keys, seed data or data export (GDPR).

Frontend

- The landing copy is written in `apps/landing/src/pages/index.astro` (still placeholder text) and
  the landing does not share the web's theme.
- The sidebar's collapsed state is not restored on reload: shadcn writes the `sidebar_state`
  cookie, but nothing reads it during SSR. The sheet's screen-reader title ("Sidebar") comes in
  English from `components/ui/sidebar.tsx`.

Starting a new product

- `pnpm init:project` renames the product name, slug and npm scope. Two of the renamed values are
  functional: the slug prefixes the session cookie (`COOKIE_PREFIX` in `packages/auth/src/config.ts`)
  and the Stripe price lookup keys (`PRICE_KEY_PREFIX` in `apps/api/src/billing/subscription-plan.ts`).
  Renaming after the prices exist means creating them again; the script warns about both.

Backend

- Tenancy by convention: there is no generic guard. `forOrganization()`
  (`packages/db/src/organization/index.ts`) exposes hand-written methods per domain, and isolation
  between organizations depends on every query filtering by `organizationId`.
- A new module touches many places (schema, scope, contract, router, permissions, MCP tools,
  screen, navigation, i18n, tests). Workspaces is the reference module to copy; nothing generates
  the pieces.
- Coupled product pieces:
  - Credits are part of every procedure's base contract: the `PAYMENT_REQUIRED` error with its
    metric in `packages/contract/src/common.ts`.
  - The plan's seat count is part of member management (`packages/auth/src/organization.ts`).
  - Plans are fixed by a SQL CHECK (`organizations_plan_check` in
    `packages/db/src/schema/organizations.ts`), so changing them needs a migration.
- Files: no folders, no moving between the organization and a workspace, no previews and no
  malware scanning (a file subscriber is the place for it). Every plan has the same file policy.
  The type is checked by extension; the bytes are not inspected. An object whose delete fails
  stays in the bucket (logged), and RustFS has no release for Intel Macs (install it on PATH).
- Hard to remove: credits, MCP/OAuth (`createApp` in `apps/api/src/app.ts` always mounts the MCP
  routes; no setting turns them off) and, above all, multi-organization mode.
