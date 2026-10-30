# Arrakit

A SaaS base: React + TanStack Start web app, Hono + oRPC API, Drizzle on Postgres (PGlite in
dev/tests), Better Auth, Stripe, and an Astro landing, in a pnpm + Turborepo monorepo.

It reproduces the features and screens of saas-base on a new stack, with the shadcn/ui default theme.

```bash
pnpm install
pnpm dev        # api :3000, web :4200, landing :4321
pnpm test
```

See [AGENTS.md](AGENTS.md) for the stack, layout, rules and commands, and `docs/spec/` for the features.
