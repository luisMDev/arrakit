import { defineHandler, proxyRequest, type H3Event } from 'nitro/h3'

/**
 * The client IP the API should see: Cloudflare's `cf-connecting-ip` when the web server sits
 * behind Cloudflare (the TCP peer is then a Cloudflare edge), else the peer that connected.
 */
export function clientIpOf(headers: Headers, peerIp: string | undefined): string | undefined {
  return headers.get('cf-connecting-ip')?.trim() || peerIp || undefined
}

/** Where a request to the web server goes on the API: same path and query on `apiOrigin`. */
export function apiTargetOf(url: URL, apiOrigin = 'http://localhost:5000'): string {
  return `${apiOrigin.replace(/\/$/, '')}${url.pathname}${url.search}`
}

/**
 * Proxies one request for an API path (see `apiProxiedPaths`) to the API.
 *
 * API_ORIGIN is read on every request, not at build time, so one build can be pointed at any
 * API.
 *
 * Path, query, method, the streamed body, cookies and Origin pass through; `xfwd` sets
 * x-forwarded-host/-proto/-port; redirects reach the browser unfollowed. The incoming
 * x-forwarded-for is dropped and replaced by exactly one IP (`clientIpOf`): Better Auth
 * (no trustedProxies) ignores a multi-hop chain, which would leave sessions without an IP
 * and the rate limit without a per-client key. x-real-ip passes through untouched.
 */
export function proxyToApi(event: H3Event, apiOrigin = process.env.API_ORIGIN) {
  const clientIp = clientIpOf(event.req.headers, event.req.ip)
  return proxyRequest(event, apiTargetOf(event.url, apiOrigin), {
    xfwd: true,
    filterHeaders: ['x-forwarded-for'],
    headers: clientIp ? { 'x-forwarded-for': clientIp } : undefined,
  })
}

export default defineHandler((event) => proxyToApi(event))
