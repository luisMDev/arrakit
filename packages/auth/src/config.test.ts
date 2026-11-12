import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { isTrustedOrigin, loadAuthConfig, mcpResourceURL, oauthIssuer } from './config'

const SECRET = 'x'.repeat(32)
const base = { BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: 'http://localhost:5200' }

describe('loadAuthConfig', () => {
  it('names every missing variable in one error', () => {
    expect(() => loadAuthConfig({ NODE_ENV: 'production' })).toThrow(
      '[auth] missing env: BETTER_AUTH_SECRET, BETTER_AUTH_URL',
    )
  })

  it('counts an empty string as missing', () => {
    expect(() => loadAuthConfig({ BETTER_AUTH_SECRET: '', BETTER_AUTH_URL: '' })).toThrow(
      '[auth] missing env: BETTER_AUTH_SECRET, BETTER_AUTH_URL',
    )
  })

  it('boots in production without Google', () => {
    expect(loadAuthConfig({ ...base, NODE_ENV: 'production' }).google).toBeUndefined()
  })

  it('never takes half a pair', () => {
    expect(() => loadAuthConfig({ ...base, GOOGLE_CLIENT_ID: 'id' })).toThrow(
      '[auth] missing env: GOOGLE_CLIENT_SECRET',
    )
    expect(() => loadAuthConfig({ ...base, MICROSOFT_CLIENT_SECRET: 's' })).toThrow(
      '[auth] missing env: MICROSOFT_CLIENT_ID',
    )
  })

  it('refuses a secret shorter than 32 characters', () => {
    expect(() => loadAuthConfig({ ...base, BETTER_AUTH_SECRET: 'short' })).toThrow('32')
  })

  describe('in production', () => {
    const production = { ...base, NODE_ENV: 'production' }

    it.each(['change-me-to-a-long-random-string', `change-me-${'x'.repeat(32)}`])(
      'refuses the placeholder secret %s',
      (secret) => {
        expect(() => loadAuthConfig({ ...production, BETTER_AUTH_SECRET: secret })).toThrow(
          '[auth] BETTER_AUTH_SECRET is a placeholder; set a long random secret in production',
        )
      },
    )

    it('takes a real secret', () => {
      expect(loadAuthConfig(production).secret).toBe(SECRET)
    })
  })

  it('takes the example secret outside production', () => {
    for (const NODE_ENV of [undefined, 'development', 'test'])
      expect(
        loadAuthConfig({
          ...base,
          NODE_ENV,
          BETTER_AUTH_SECRET: 'change-me-to-a-long-random-string',
        }).secret,
      ).toBe('change-me-to-a-long-random-string')
  })

  it('refuses a base URL that is not a URL', () => {
    expect(() => loadAuthConfig({ ...base, BETTER_AUTH_URL: 'nope' })).toThrow(
      '[auth] BETTER_AUTH_URL is not a URL: "nope"',
    )
  })

  it('leaves optional providers out', () => {
    const config = loadAuthConfig(base)
    expect(config.google).toBeUndefined()
    expect(config.microsoft).toBeUndefined()
  })

  it('takes both providers when both pairs are set', () => {
    const config = loadAuthConfig({
      ...base,
      GOOGLE_CLIENT_ID: 'g',
      GOOGLE_CLIENT_SECRET: 'gs',
      MICROSOFT_CLIENT_ID: 'm',
      MICROSOFT_CLIENT_SECRET: 'ms',
    })
    expect(config.google).toEqual({ clientId: 'g', clientSecret: 'gs' })
    expect(config.microsoft).toEqual({ clientId: 'm', clientSecret: 'ms' })
  })

  describe('BETTER_AUTH_JWT_KEY', () => {
    it('leaves the key to the JWT plugin when unset or empty', () => {
      expect(loadAuthConfig(base).jwtKey).toBeUndefined()
      expect(loadAuthConfig({ ...base, BETTER_AUTH_JWT_KEY: '' }).jwtKey).toBeUndefined()
    })

    it('reads a private ES256 JWK', () => {
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const jwk = { ...privateKey.export({ format: 'jwk' }), kid: 'dev-key' }
      const config = loadAuthConfig({ ...base, BETTER_AUTH_JWT_KEY: JSON.stringify(jwk) })
      expect(config.jwtKey?.kid).toBe('dev-key')
      expect(config.jwtKey?.privateJwk.d).toBe(jwk.d)
    })

    it('refuses anything else', () => {
      expect(() => loadAuthConfig({ ...base, BETTER_AUTH_JWT_KEY: '{"kty":"EC"}' })).toThrow(
        '[auth] BETTER_AUTH_JWT_KEY must be a private ES256 JWK',
      )
    })
  })

  it('derives the trusted origins from the base and web URLs', () => {
    const config = loadAuthConfig({ ...base, WEB_URL: 'https://app.example.com/some/path/' })
    expect(config.webOrigin).toBe('https://app.example.com')
    expect(config.trustedOrigins).toEqual(['http://localhost:5200', 'https://app.example.com'])
    expect(
      loadAuthConfig({ ...base, BETTER_AUTH_URL: 'http://localhost:5200/' }).trustedOrigins,
    ).toEqual(['http://localhost:5200'])
  })
})

describe('URLs', () => {
  it.each([
    'http://localhost:5200',
    'https://app.example.com/',
    'https://app.example.com/some/path',
  ])('puts the MCP resource at the origin of %s', (url) =>
    expect(mcpResourceURL(url)).toBe(`${new URL(url).origin}/api/mcp`),
  )

  it('derives the issuer', () => {
    expect(oauthIssuer('http://localhost:5200')).toBe('http://localhost:5200/api/auth')
  })
})

describe('isTrustedOrigin', () => {
  const trusted = ['http://localhost:5200']
  it.each([
    ['http://localhost:5200', true],
    ['http://localhost:5200.evil.example', false],
    ['null', false],
    [null, false],
    [undefined, false],
  ])('%j → %s', (origin, ok) => expect(isTrustedOrigin(origin, trusted)).toBe(ok))
})
