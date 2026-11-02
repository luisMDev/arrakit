import { AUTH_BASE_PATH, MCP_PATH } from '@arrakit/auth'
import type { MiddlewareHandler } from 'hono'
import { secureHeaders } from 'hono/secure-headers'

const CROSS_ORIGIN_PATHS = [
  '/.well-known',
  MCP_PATH,
  `${AUTH_BASE_PATH}/oauth2`,
  `${AUTH_BASE_PATH}/jwks`,
]

export function isCrossOriginPath(path: string): boolean {
  return CROSS_ORIGIN_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

const baseline = secureHeaders({
  // Better Auth's error page (/api/auth/error) is the only HTML the API serves: inline styles.
  contentSecurityPolicy: {
    defaultSrc: ["'none'"],
    styleSrc: ["'unsafe-inline'"],
    frameAncestors: ["'none'"],
  },
  crossOriginResourcePolicy: false,
  referrerPolicy: 'no-referrer',
  strictTransportSecurity: 'max-age=31536000',
  xFrameOptions: 'DENY',
})

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await baseline(c, next)
  c.res.headers.set(
    'Cross-Origin-Resource-Policy',
    isCrossOriginPath(c.req.path) ? 'cross-origin' : 'same-origin',
  )
}
