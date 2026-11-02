// Shared ESLint flat config for every workspace in arrakit.
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * Modules that only packages/db may import (and every `@aws-sdk/*`). Everything else (apps/api
 * included) must go through `openData()` / `forOrganization(id)` from `@arrakit/db`.
 */
const DATA_ONLY_MODULES = ['pg', 'pg-boss', 'drizzle-orm', 'drizzle-kit', '@electric-sql/pglite']

const DRIVER_MESSAGE =
  'Only @arrakit/db may import data drivers. Use openData() / forOrganization().'
const INTERNALS_MESSAGE =
  'Use @arrakit/db (openData() / forOrganization()); its schema, testing helpers and sources are for packages/db and tests.'

/**
 * `pg`, `pg/lib/client`, `drizzle-orm/node-postgres`, `@aws-sdk/...`, but not `pg-format` or
 * `pgvector`. esquery regexes cannot contain `/`, so `.` stands for it and `[^\\w-]` for the
 * subpath separator.
 */
const DRIVER_SPECIFIER = `^(${[...DATA_ONLY_MODULES, '@aws-sdk']
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('/', '.'))
  .join('|')})([^\\w-].*)?$`
/** Any @arrakit/db subpath: `/schema`, `/testing`, `/src/...`. */
const INTERNALS_SPECIFIER = '^@arrakit.db.+$'

/** `require()` and dynamic `import()`, which no-restricted-imports does not see. */
const restrictedSyntax = (specifier, message) => [
  { selector: `CallExpression[callee.name='require'][arguments.0.value=/${specifier}/]`, message },
  { selector: `ImportExpression[source.value=/${specifier}/]`, message },
  {
    selector: `ImportExpression[source.expressions.length=0][source.quasis.0.value.cooked=/${specifier}/]`,
    message,
  },
]

const guard = ({ internals, paths = [] }) => ({
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [...DATA_ONLY_MODULES.map((name) => ({ name, message: DRIVER_MESSAGE })), ...paths],
        patterns: [
          {
            group: [...DATA_ONLY_MODULES.map((name) => `${name}/*`), '@aws-sdk/*'],
            message: DRIVER_MESSAGE,
          },
          ...(internals ? [{ group: ['@arrakit/db/*'], message: INTERNALS_MESSAGE }] : []),
        ],
      },
    ],
    'no-restricted-syntax': [
      'error',
      ...restrictedSyntax(DRIVER_SPECIFIER, DRIVER_MESSAGE),
      ...(internals ? restrictedSyntax(INTERNALS_SPECIFIER, INTERNALS_MESSAGE) : []),
    ],
  },
})

/** Test files and test harnesses may reach @arrakit/db/schema and /testing, never the drivers. */
const TEST_FILES = [
  '**/*.test.{ts,tsx,js,mjs,cjs}',
  '**/*.spec.{ts,tsx,js,mjs,cjs}',
  '**/testing.{ts,tsx}',
  '**/testing/**',
  '**/test/**',
  '**/e2e/**',
]

/**
 * Keeps data access behind openData() / forOrganization(): the drivers are refused everywhere
 * (import, export-from, require, dynamic import, .cjs included), and @arrakit/db subpaths outside
 * test files. `restrictedPaths` adds workspace-specific
 * `no-restricted-imports` paths, allowed in test files and in `restrictedPathsAllowedIn`.
 */
const restrictImports = ({ restrictedPaths = [], restrictedPathsAllowedIn = [] }) => [
  guard({ internals: true, paths: restrictedPaths }),
  ...(restrictedPathsAllowedIn.length > 0
    ? [{ files: restrictedPathsAllowedIn, ...guard({ internals: true }) }]
    : []),
  { files: TEST_FILES, ...guard({ internals: false }) },
]

/** Base config: JS + TypeScript recommended rules, Prettier last. */
export function base({ restrictData = true, ...restricted } = {}) {
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
    ...(restrictData ? restrictImports(restricted) : []),
    prettier,
  )
}

/** Base config plus React hooks rules, for React workspaces (apps/web). */
export function react(options = {}) {
  return [...base(options), reactHooks.configs.flat['recommended-latest']]
}

export default base()
