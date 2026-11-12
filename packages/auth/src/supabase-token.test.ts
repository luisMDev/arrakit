import { generateKeyPairSync } from 'node:crypto'

import { jwks } from '@arrakit/db/schema'
import { type TestData, openTestData } from '@arrakit/db/testing'
import { verifyJwsAccessToken } from 'better-auth/oauth2'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createAuth } from './auth'
import { loadAuthConfig, oauthIssuer } from './config'
import { type MemberClaims } from './permissions'
import { SUPABASE_TOKEN_SECONDS, signSupabaseToken } from './supabase-token'
import { testOrganizationDeps } from './test-deps'

const WEB = 'http://localhost:5200'
const env = { BETTER_AUTH_SECRET: 'x'.repeat(32), BETTER_AUTH_URL: WEB }

const claims: MemberClaims = {
  sub: '7d3c1f4e-1b2a-4c5d-8e9f-0a1b2c3d4e5f',
  role: 'authenticated',
  org_id: '0f1e2d3c-4b5a-4968-8776-655443322110',
  permissions: ['task:read'],
  actor: 'user',
}

const decode = (part: string) =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>
const partsOf = (token: string) => {
  const [header, payload] = token.split('.')
  return { header: decode(header!), payload: decode(payload!) }
}

describe('signSupabaseToken (PGlite)', () => {
  let data: TestData
  beforeEach(async () => {
    data = await openTestData()
  })
  afterEach(() => data.close())

  function authWith(extra: Record<string, string> = {}) {
    return createAuth({
      config: loadAuthConfig({ ...env, ...extra }),
      data,
      mailer: { send: async () => {} },
      organizations: testOrganizationDeps,
    })
  }

  it('signs the claims for ten minutes with the stored ES256 key', async () => {
    const auth = authWith()
    const now = new Date('2026-11-12T10:00:00.000Z')

    const { token, expiresAt } = await signSupabaseToken(auth, claims, now)

    const rows = await data.db.select().from(jwks)
    expect(rows).toHaveLength(1)
    const { header, payload } = partsOf(token)
    expect(header).toMatchObject({ alg: 'ES256', kid: rows[0]!.id })
    const iat = Math.floor(now.getTime() / 1000)
    expect(payload).toEqual({
      ...claims,
      aud: 'authenticated',
      iss: oauthIssuer(WEB),
      iat,
      exp: iat + SUPABASE_TOKEN_SECONDS,
    })
    expect(SUPABASE_TOKEN_SECONDS).toBe(600)
    expect(expiresAt).toEqual(new Date((iat + 600) * 1000))
  })

  it('signs a token that verifies against the served keys', async () => {
    const auth = authWith()
    const { token } = await signSupabaseToken(auth, claims)

    const verified = await verifyJwsAccessToken(token, {
      jwksFetch: () => auth.api.getJwks(),
      jwksCacheKey: {},
      verifyOptions: { issuer: oauthIssuer(WEB), audience: 'authenticated' },
    })
    expect(verified).toMatchObject({ sub: claims.sub, org_id: claims.org_id })
  })

  it('signs with the configured key and stores none', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const jwk = { ...privateKey.export({ format: 'jwk' }), kid: 'configured-key' }
    const auth = authWith({ BETTER_AUTH_JWT_KEY: JSON.stringify(jwk) })

    const { token } = await signSupabaseToken(auth, claims)

    expect(partsOf(token).header).toMatchObject({ alg: 'ES256', kid: 'configured-key' })
    const { keys } = await auth.api.getJwks()
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatchObject({ kid: 'configured-key', x: jwk.x, y: jwk.y })
    expect(keys[0]).not.toHaveProperty('d')
    expect(await data.db.select().from(jwks)).toHaveLength(0)
    await expect(
      verifyJwsAccessToken(token, {
        jwksFetch: () => auth.api.getJwks(),
        jwksCacheKey: {},
        verifyOptions: { issuer: oauthIssuer(WEB), audience: 'authenticated' },
      }),
    ).resolves.toMatchObject({ sub: claims.sub })
  })
})
