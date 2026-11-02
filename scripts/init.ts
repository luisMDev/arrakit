import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { deriveNames, validateNames, type Identity, type NameInput } from './init/rename.ts'
import { readIdentity, runInit } from './init/run.ts'

const USAGE = `Usage: pnpm init:project [--name "Acme Cloud"] [--slug acme-cloud] [--scope acme] [--dry-run] [--yes]

Renames the product across the repository:
  --name     Product name shown to people (APP_NAME, emails, titles)
  --slug     Lowercase id for cookies, Stripe price lookup keys, storage keys (default: from --name)
  --scope    npm scope of the workspaces, without @ (default: the slug)
  --dry-run  List the files that would change and write nothing
  --yes      Do not ask for confirmation`

type Ask = (question: string, fallback: string) => Promise<string>

async function collectNames(input: NameInput, ask: Ask | undefined): Promise<Identity> {
  if (!ask) return deriveNames(input)
  const name = input.name || (await ask('Product name', ''))
  const derived = deriveNames({ ...input, name })
  const slug = input.slug ?? (await ask('Slug', derived.slug))
  const scope = input.scope ?? (await ask('npm scope', deriveNames({ name, slug }).scope))
  return deriveNames({ name, slug, scope })
}

function describe(from: Identity, to: Identity): string {
  return [
    `  name   ${from.name} → ${to.name}`,
    `  slug   ${from.slug} → ${to.slug}`,
    `  scope  @${from.scope} → @${to.scope}`,
    `  ids    ${from.pascal} → ${to.pascal}`,
  ].join('\n')
}

const WARNINGS = (to: Identity) => `
Before you go on:
  - Stripe prices are found by lookup key (${to.slug}_pro_monthly, ...). Prices created under the
    old slug are no longer found: run the API's Stripe prices script again.
  - The session cookie is now named ${to.slug}.session_token, so existing sessions are signed out.

Next: pnpm install && pnpm typecheck && pnpm test`

export async function main(argv: string[], cwd = process.cwd()): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      name: { type: 'string' },
      slug: { type: 'string' },
      scope: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help) {
    console.log(USAGE)
    return 0
  }

  const interactive = stdin.isTTY && stdout.isTTY
  if (!values.name && !interactive) {
    console.error(`--name is required when not running in a terminal.\n\n${USAGE}`)
    return 1
  }

  const prompt = interactive ? createInterface({ input: stdin, output: stdout }) : undefined
  try {
    const ask: Ask | undefined = prompt
      ? async (question, fallback) =>
          (await prompt.question(fallback ? `${question} (${fallback}): ` : `${question}: `)) ||
          fallback
      : undefined

    const from = readIdentity(cwd)
    const to = await collectNames(
      { name: values.name ?? '', slug: values.slug, scope: values.scope },
      ask,
    )
    const problems = validateNames(to)
    if (problems.length > 0) {
      console.error(problems.map((problem) => `  - ${problem}`).join('\n'))
      return 1
    }

    console.log(`\n${describe(from, to)}\n`)
    const dryRun = values['dry-run']
    if (!dryRun && !values.yes && prompt) {
      const answer = await prompt.question('Rewrite the repository? (y/N) ')
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log('Nothing changed.')
        return 0
      }
    }

    const changes = runInit({ cwd, from, to, dryRun })
    for (const { path, count } of changes) console.log(`  ${String(count).padStart(4)}  ${path}`)
    const total = changes.reduce((sum, change) => sum + change.count, 0)
    console.log(
      `\n${dryRun ? 'Would rewrite' : 'Rewrote'} ${total} occurrences in ${changes.length} files.`,
    )
    if (!dryRun && changes.length > 0) console.log(WARNINGS(to))
    return 0
  } finally {
    prompt?.close()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2))
}
