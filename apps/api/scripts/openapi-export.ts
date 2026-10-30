import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { openApiDocument } from '../src/app'

/** `pnpm --filter @arrakit/api openapi:export <file>`: writes the OpenAPI document, no DB needed. */
async function main() {
  const target = process.argv[2]
  if (!target) throw new Error('usage: openapi:export <output.json>')
  const file = resolve(target)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(await openApiDocument(), null, 2)}\n`)
  console.info(`[api] OpenAPI document written to ${file}`)
}

main().catch((error: unknown) => {
  console.error('[api] OpenAPI export failed', error)
  process.exit(1)
})
