// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { apiOriginFrom, apiProxiedPaths } from './api-proxy'

// The proxy itself (xfwd, single client IP, redirects, per-request API_ORIGIN) is covered by
// src/server/api-proxy-handler.test.ts.
describe('api-proxy', () => {
  it('lists the API paths and the OAuth metadata paths', () => {
    expect(apiProxiedPaths).toEqual([
      '/api',
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-protected-resource',
    ])
  })

  it('defaults the API origin to localhost:5000 and drops a trailing slash', () => {
    expect(apiOriginFrom(undefined)).toBe('http://localhost:5000')
    expect(apiOriginFrom('https://api.example.com/')).toBe('https://api.example.com')
  })
})
