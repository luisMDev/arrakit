import { createPrivateKey } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { KEYS_FILE, ensureSigningKeys } from './supabase-keys.ts'

let repo: string

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'supabase-keys-'))
  mkdirSync(join(repo, 'supabase'))
})
afterEach(() => rmSync(repo, { recursive: true, force: true }))

describe('ensureSigningKeys', () => {
  it('writes one ES256 signing key the stack can load, readable only by its owner', () => {
    expect(ensureSigningKeys(repo)).toBe(true)

    const file = join(repo, KEYS_FILE)
    const keys = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[]
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' })
    expect(keys[0]?.kid).toMatch(/^[0-9a-f-]{36}$/)
    expect(createPrivateKey({ key: keys[0] as never, format: 'jwk' }).asymmetricKeyType).toBe('ec')
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('leaves the keys that are already there', () => {
    writeFileSync(join(repo, KEYS_FILE), '[{"kid":"mine"}]')
    expect(ensureSigningKeys(repo)).toBe(false)
    expect(readFileSync(join(repo, KEYS_FILE), 'utf8')).toBe('[{"kid":"mine"}]')
  })
})
