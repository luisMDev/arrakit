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

const escapeSpecifier = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('/', '.')

/**
 * The modules or a subpath of them, as a `require()` / `import()` regex: `pg`, `pg/lib/client`,
 * `drizzle-orm/node-postgres`, `@aws-sdk/...`, but not `pg-format` or `pgvector`. esquery regexes
 * cannot contain `/`, so `.` stands for it and `[^\\w-]` for the subpath separator.
 */
const moduleSpecifier = (names) => `^(${names.map(escapeSpecifier).join('|')})([^\\w-].*)?$`

const DRIVER_SPECIFIER = moduleSpecifier([...DATA_ONLY_MODULES, '@aws-sdk'])
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
        paths: [
          ...DATA_ONLY_MODULES.map((name) => ({ name, message: DRIVER_MESSAGE })),
          ...paths.map(({ name, message }) => ({ name, message })),
        ],
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
      ...paths.flatMap(({ name, message }) =>
        restrictedSyntax(`^${escapeSpecifier(name)}$`, message),
      ),
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

/** Restricted in every guarded workspace; a workspace entry with the same name replaces one. */
const DEFAULT_RESTRICTED_PATHS = [
  {
    name: '@supabase/supabase-js',
    message: "Only @arrakit/db and the web's realtime module import the Supabase client.",
  },
]

/**
 * Keeps data access behind openData() / forOrganization(): the drivers are refused everywhere
 * (import, export-from, require, dynamic import, .cjs included), and @arrakit/db subpaths outside
 * test files. `restrictedPaths` (`{ name, message, allowedIn? }`) refuses more modules, on top of
 * DEFAULT_RESTRICTED_PATHS; each one is allowed in test files and in the files its `allowedIn`
 * names.
 */
const restrictImports = ({ restrictedPaths = [] }) => {
  const own = new Set(restrictedPaths.map(({ name }) => name))
  const paths = [
    ...DEFAULT_RESTRICTED_PATHS.filter(({ name }) => !own.has(name)),
    ...restrictedPaths,
  ]
  const exceptions = [...new Set(paths.flatMap(({ allowedIn = [] }) => allowedIn))]
  return [
    guard({ internals: true, paths }),
    ...exceptions.map((file) => ({
      files: [file],
      ...guard({
        internals: true,
        paths: paths.filter(({ allowedIn = [] }) => !allowedIn.includes(file)),
      }),
    })),
    { files: TEST_FILES, ...guard({ internals: false }) },
  ]
}

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
