import { generateKeyPairSync, randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { fixedKeyAdapter, parseJwtKey } from './jwt-key'

const MESSAGE =
  '[auth] BETTER_AUTH_JWT_KEY must be a private ES256 JWK (kty EC, crv P-256, x, y, d) with a kid'

function privateJwk(curve = 'P-256') {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: curve })
  return { ...privateKey.export({ format: 'jwk' }), kid: randomUUID() }
}

describe('parseJwtKey', () => {
  it('reads the kid, the public half and the private half', () => {
    const jwk = privateJwk()
    const key = parseJwtKey(JSON.stringify(jwk))
    expect(key.kid).toBe(jwk.kid)
    expect(key.publicJwk).toEqual({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y })
    expect(key.privateJwk).toEqual({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d })
  })

  const { d: _d, ...publicOnly } = privateJwk()
  const { kid: _kid, ...withoutKid } = privateJwk()
  const { privateKey: edKey } = generateKeyPairSync('ed25519')
  it.each([
    ['text that is not JSON', 'not json {"d":"secret"}'],
    ['a public-only key', JSON.stringify(publicOnly)],
    ['an OKP key', JSON.stringify({ ...edKey.export({ format: 'jwk' }), kid: 'k' })],
    ['another curve', JSON.stringify(privateJwk('P-384'))],
    ['a key without a kid', JSON.stringify(withoutKid)],
    ['a JSON value that is not an object', 'null'],
  ])('refuses %s without echoing it', (_label, raw) => {
    let error: unknown
    try {
      parseJwtKey(raw)
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(MESSAGE)
    expect((error as Error).message).not.toContain(raw)
  })
})

describe('fixedKeyAdapter', () => {
  const jwk = privateJwk()
  const adapter = fixedKeyAdapter(parseJwtKey(JSON.stringify(jwk)))

  it('serves the one configured key', async () => {
    const keys = await adapter.getJwks!({} as never)
    expect(keys).toHaveLength(1)
    const [key] = keys!
    expect(key).toMatchObject({ id: jwk.kid, alg: 'ES256', crv: 'P-256' })
    expect(JSON.parse(key!.publicKey)).not.toHaveProperty('d')
    expect(JSON.parse(key!.privateKey)).toMatchObject({ d: jwk.d })
  })

  it('never creates a key', async () => {
    await expect(adapter.createJwk!({} as never, {} as never)).rejects.toThrow()
  })
})
