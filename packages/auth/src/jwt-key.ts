import type { Jwk, JwtOptions } from 'better-auth/plugins'

interface PublicJwk {
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
}

export interface JwtKey {
  kid: string
  publicJwk: PublicJwk
  privateJwk: PublicJwk & { d: string }
}

const INVALID =
  '[auth] BETTER_AUTH_JWT_KEY must be a private ES256 JWK (kty EC, crv P-256, x, y, d) with a kid'

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== ''

export function parseJwtKey(raw: string): JwtKey {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(INVALID)
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error(INVALID)
  const { kty, crv, x, y, d, kid } = parsed as Record<string, unknown>
  if (kty !== 'EC' || crv !== 'P-256') throw new Error(INVALID)
  if (!nonEmpty(x) || !nonEmpty(y) || !nonEmpty(d) || !nonEmpty(kid)) throw new Error(INVALID)
  const publicJwk: PublicJwk = { kty, crv, x, y }
  return { kid, publicJwk, privateJwk: { ...publicJwk, d } }
}

/** Makes the JWT plugin sign with one key from the environment and never store a key. */
export function fixedKeyAdapter(key: JwtKey): NonNullable<JwtOptions['adapter']> {
  const stored: Jwk = {
    id: key.kid,
    publicKey: JSON.stringify(key.publicJwk),
    privateKey: JSON.stringify(key.privateJwk),
    createdAt: new Date(0),
    alg: 'ES256',
    crv: 'P-256',
  }
  return {
    getJwks: async () => [stored],
    createJwk: async () => {
      throw new Error('[auth] the JWT key comes from BETTER_AUTH_JWT_KEY; no key is created')
    },
  }
}
