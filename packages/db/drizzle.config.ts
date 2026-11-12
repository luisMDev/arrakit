import { defineConfig } from 'drizzle-kit'

// `pnpm --filter @arrakit/db db:generate` writes SQL migrations where the Supabase CLI applies
// them from (`pnpm db:migrate`). The journal in meta/ is what the API checks at boot, so a
// hand-written migration is added with `db:generate --custom`, never as a loose file.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: '../../supabase/migrations',
  casing: 'snake_case',
  schemaFilter: ['public', 'better_auth'],
  migrations: { prefix: 'supabase' },
  entities: { roles: { provider: 'supabase' } },
})
