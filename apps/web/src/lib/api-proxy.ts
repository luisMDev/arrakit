/** Paths the API serves; the web server proxies them so web and API look like one site. */
export const apiProxiedPaths = [
  '/api',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
] as const

export interface ApiProxyRule {
  proxy: { to: string; xfwd: true; filterHeaders: string[] }
}

export const apiOriginFrom = (value: string | undefined) =>
  (value ?? 'http://localhost:3000').replace(/\/$/, '')

/**
 * Nitro route rules that hand the API paths to `apiOrigin`.
 *
 * `xfwd` adds x-forwarded-for/-host/-proto, so Better Auth records the client IP on sessions
 * and keys its rate limit per client. Cookies and Origin pass through untouched, and
 * redirects reach the browser unfollowed (OAuth consent and callbacks are the browser's).
 *
 * The incoming x-forwarded-for is dropped first, so the API gets exactly one IP (the peer
 * that connected to the web server), as saas-base's edge proxy does. h3 would otherwise
 * append to a client-sent chain, and Better Auth (no trustedProxies) ignores any
 * multi-hop X-Forwarded-For, which would leave sessions without an IP and the rate limit
 * without a per-client key. x-real-ip is still passed through: a platform edge in front of
 * the web server sets it, and the API reads it first (spec auth-onboarding section 10).
 */
export function apiProxyRules(apiOrigin: string): Record<string, ApiProxyRule> {
  const origin = apiOriginFrom(apiOrigin)
  return Object.fromEntries(
    apiProxiedPaths.map((path) => [
      `${path}/**`,
      { proxy: { to: `${origin}${path}/**`, xfwd: true, filterHeaders: ['x-forwarded-for'] } },
    ]),
  )
}
