import { defineConfig } from 'tsdown'

// Bundles the API for production. Workspace packages ship TypeScript source,
// so they are inlined; npm dependencies stay external.
export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  deps: { alwaysBundle: [/^@arrakit\//] },
  // @arrakit/db applies these migrations on boot; the bundle looks for ./drizzle beside main.mjs.
  copy: [{ from: '../../packages/db/drizzle', to: 'dist' }],
})
