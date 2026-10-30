import { describe, expect, it } from 'vitest'

import { loadAuthConfig, mcpResourceURL, oauthIssuer } from './config'

describe('loadAuthConfig', () => {
  it('names every missing variable in one error', () => {
    expect(() => loadAuthConfig({ NODE_ENV: 'production' })).toThrow(
      '[auth] missing env: BETTER_AUTH_SECRET, BETTER_AUTH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET',
    )
  })

  it('derives origins and the MCP URLs', () => {
    const config = loadAuthConfig({
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      BETTER_AUTH_URL: 'http://localhost:4200/',
    })
    expect(config.trustedOrigins).toEqual(['http://localhost:4200'])
    expect(mcpResourceURL(config.baseURL)).toBe('http://localhost:4200/api/mcp')
    expect(oauthIssuer(config.baseURL)).toBe('http://localhost:4200/api/auth')
  })
})
