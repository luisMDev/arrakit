import { createPrivateKey, createPublicKey } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { KEYS_FILE, STACK_ENV_FILE, ensureSigningKeys, writeStackEnv } from './supabase-keys.ts'

let repo: string

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'supabase-keys-'))
  mkdirSync(join(repo, 'supabase'))
  mkdirSync(join(repo, 'apps', 'api'), { recursive: true })
})
afterEach(() => rmSync(repo, { recursive: true, force: true }))

const keysFile = () => join(repo, KEYS_FILE)
const envFile = () => join(repo, STACK_ENV_FILE)
const readKeys = () => JSON.parse(readFileSync(keysFile(), 'utf8')) as Record<string, unknown>[]
const readEnv = () => parseEnv(readFileSync(envFile(), 'utf8'))
const jwtKey = () => JSON.parse(readEnv().BETTER_AUTH_JWT_KEY ?? '') as Record<string, unknown>

describe('ensureSigningKeys', () => {
  it('gives a fresh clone the stack key and the public half of Better Auth’s key', () => {
    expect(ensureSigningKeys(repo)).toBe(true)

    const keys = readKeys()
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' })
    expect(keys[0]?.kid).toMatch(/^[0-9a-f-]{36}$/)
    expect(createPrivateKey({ key: keys[0] as never, format: 'jwk' }).asymmetricKeyType).toBe('ec')

    const own = jwtKey()
    expect(own).toMatchObject({ kty: 'EC', crv: 'P-256' })
    expect(createPrivateKey({ key: own as never, format: 'jwk' }).asymmetricKeyType).toBe('ec')
    expect(keys[1]).toEqual({
      kty: 'EC',
      crv: 'P-256',
      x: own.x,
      y: own.y,
      kid: own.kid,
      alg: 'ES256',
      use: 'sig',
      key_ops: ['verify'],
    })
    expect(createPublicKey({ key: keys[1] as never, format: 'jwk' }).asymmetricKeyType).toBe('ec')

    expect(statSync(keysFile()).mode & 0o777).toBe(0o600)
    expect(statSync(envFile()).mode & 0o777).toBe(0o600)
  })

  it('changes nothing on a second run', () => {
    ensureSigningKeys(repo)
    const keys = readFileSync(keysFile(), 'utf8')
    const env = readFileSync(envFile(), 'utf8')

    expect(ensureSigningKeys(repo)).toBe(false)
    expect(readFileSync(keysFile(), 'utf8')).toBe(keys)
    expect(readFileSync(envFile(), 'utf8')).toBe(env)
  })

  it('adds Better Auth’s key after the stack key that is already there', () => {
    const stackKey = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd', kid: 'stack' }
    writeFileSync(keysFile(), JSON.stringify([stackKey]), { mode: 0o644 })

    expect(ensureSigningKeys(repo)).toBe(true)
    const keys = readKeys()
    expect(keys).toHaveLength(2)
    expect(keys[0]).toEqual(stackKey)
    expect(keys[1]?.kid).toBe(jwtKey().kid)
    expect(keys[1]).not.toHaveProperty('d')
    expect(statSync(keysFile()).mode & 0o777).toBe(0o600)
  })

  it('replaces a stale public key when the stack env file is gone', () => {
    ensureSigningKeys(repo)
    const [stackKey, stale] = readKeys()
    unlinkSync(envFile())

    expect(ensureSigningKeys(repo)).toBe(true)
    const keys = readKeys()
    expect(keys).toHaveLength(2)
    expect(keys[0]).toEqual(stackKey)
    expect(keys[1]?.kid).not.toBe(stale?.kid)
    expect(keys[1]?.kid).toBe(jwtKey().kid)
  })
})

describe('writeStackEnv', () => {
  it('records the stack’s URL and publishable key and keeps Better Auth’s key', () => {
    ensureSigningKeys(repo)
    const key = readEnv().BETTER_AUTH_JWT_KEY

    writeStackEnv(repo, { API_URL: 'http://127.0.0.1:54321', PUBLISHABLE_KEY: 'sb_publishable_x' })

    expect(readEnv()).toEqual({
      BETTER_AUTH_JWT_KEY: key,
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    })
    expect(readFileSync(envFile(), 'utf8')).toMatch(/^# Generated/)
    expect(statSync(envFile()).mode & 0o777).toBe(0o600)
  })
})
