import { describe, expect, it } from 'vitest'

import { apiProxiedPaths } from '../lib/api-proxy'
import { securityRouteRules } from './security-headers'

describe('web security headers', () => {
  it('does not restrict scripts or frames, so Stripe Embedded Checkout and Vite dev load', () => {
    const csp = securityRouteRules['/**'].headers['Content-Security-Policy']
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toMatch(/default-src|script-src|frame-src|connect-src/)
  })

  it('leaves the proxied API paths with the API headers', () => {
    for (const path of apiProxiedPaths) {
      expect(securityRouteRules).toHaveProperty([`${path}/**`], { headers: false })
    }
  })
})
