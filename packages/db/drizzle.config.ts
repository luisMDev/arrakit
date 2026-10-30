import { defineConfig } from 'drizzle-kit'

// `pnpm --filter @arrakit/db db:generate` writes SQL migrations to ./drizzle.
// Migrations are applied on boot by openData() for both Postgres and PGlite.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
})
