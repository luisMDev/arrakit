/**
 * Paths the API serves; the web server proxies them so web and API look like one site.
 * `src/server/api-proxy-handler.ts` does the proxying and `vite.config.ts` registers it
 * for each of these paths.
 */
export const apiProxiedPaths = [
  '/api',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
] as const
