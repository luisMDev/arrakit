// Shared ESLint flat config for every workspace in arrakit.
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * Modules that only packages/db may import. Everything else (apps/api included)
 * must go through `openData()` / `forOrganization(id)` from `@arrakit/db`.
 */
export const DATA_ONLY_MODULES = [
  'pg',
  'pg-boss',
  'drizzle-orm',
  'drizzle-kit',
  '@electric-sql/pglite',
  '@aws-sdk/client-s3',
  '@aws-sdk/s3-request-presigner',
]

export const restrictDataImports = {
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: DATA_ONLY_MODULES.map((name) => ({
          name,
          message: 'Only @arrakit/db may import data drivers. Use openData() / forOrganization().',
        })),
        patterns: [
          {
            group: ['drizzle-orm/*', '@electric-sql/pglite/*', '@aws-sdk/*'],
            message:
              'Only @arrakit/db may import data drivers. Use openData() / forOrganization().',
          },
        ],
      },
    ],
  },
}

/** Base config: JS + TypeScript recommended rules, Prettier last. */
export function base({ restrictData = true } = {}) {
  return tseslint.config(
    {
      ignores: [
        '**/dist/**',
        '**/.output/**',
        '**/.nitro/**',
        '**/.tanstack/**',
        '**/.astro/**',
        '**/coverage/**',
        '**/routeTree.gen.ts',
        '**/drizzle/**',
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: {
        globals: { ...globals.node, ...globals.browser },
      },
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
    ...(restrictData ? [restrictDataImports] : []),
    prettier,
  )
}

/** Base config plus React hooks rules, for React workspaces (apps/web). */
export function react(options = {}) {
  return [...base(options), reactHooks.configs.flat['recommended-latest']]
}

export default base()
