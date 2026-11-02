import { apiProxiedPaths } from '../lib/api-proxy'

/**
 * The CSP only blocks framing, plugins and `<base>` rewrites, so Stripe Embedded Checkout
 * (scripts and frames from *.stripe.com) and Vite dev (inline and eval scripts) keep working.
 */
const webSecurityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Strict-Transport-Security': 'max-age=31536000',
}

export const securityRouteRules = {
  '/**': { headers: webSecurityHeaders },
  ...Object.fromEntries(apiProxiedPaths.map((path) => [`${path}/**`, { headers: false as const }])),
}
