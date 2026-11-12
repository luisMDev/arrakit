import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['src/**/*.{test,spec}.ts', 'scripts/**/*.{test,spec}.ts'],
    exclude: [...configDefaults.exclude, 'src/**/*.stack.test.ts'],
  },
})
