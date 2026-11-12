import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const KEYS_FILE = 'supabase/signing_keys.json'

function signingKey() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return {
    ...privateKey.export({ format: 'jwk' }),
    kid: randomUUID(),
    alg: 'ES256',
    use: 'sig',
    key_ops: ['sign', 'verify'],
    ext: true,
  }
}

/**
 * Writes the key the local Supabase stack signs with, unless the file is there. The stack does
 * not start without the file, and the Supabase CLI cannot generate a key until it exists.
 */
export function ensureSigningKeys(cwd: string): boolean {
  const file = join(cwd, KEYS_FILE)
  if (existsSync(file)) return false
  writeFileSync(file, `${JSON.stringify([signingKey()], null, 2)}\n`, { mode: 0o600 })
  return true
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (ensureSigningKeys(process.cwd())) console.log(`Wrote ${KEYS_FILE}`)
}
