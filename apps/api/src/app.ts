import { isTrustedOrigin } from '@arrakit/auth'
import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'
import type { McpHttpHandler } from '@modelcontextprotocol/server'
import { ORPCError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

import type { AppDeps } from './deps'
import { reportUnexpected } from './observability/error-reporter'
import { requestLog } from './observability/request-log'
import { router } from './router'
import { mcpHandler, mcpRoutes } from './routes/mcp'
import { stripeWebhookRoutes } from './routes/stripe-webhook'
import { securityHeaders } from './security-headers'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function createApp(deps: AppDeps, mcp: McpHttpHandler = mcpHandler(deps.log)) {
  const app = new Hono()
  const rpc = new RPCHandler(router)
  const authMetadata = oauthProviderAuthServerMetadata(deps.auth)

  app.use(securityHeaders)
  app.get('/health', async (c) => {
    const report = await deps.data.health()
    return c.json(report, report.status === 'ok' ? 200 : 503)
  })
  app.use(requestLog(deps.log))
  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw))
  app.get('/.well-known/oauth-authorization-server/api/auth', (c) => authMetadata(c.req.raw))
  app.route('/', stripeWebhookRoutes(deps))
  app.route('/', mcpRoutes(deps, mcp))

  app.use('/api/rpc/*', async (c, next) => {
    const crossSite =
      !SAFE_METHODS.has(c.req.method) &&
      !isTrustedOrigin(c.req.header('origin'), deps.authConfig.trustedOrigins)
    if (crossSite) {
      // The body is an oRPC error, so the client reads the message like any other refusal.
      return c.json({ json: new ORPCError('FORBIDDEN', { message: 'Use the app.' }).toJSON() }, 403)
    }
    const { matched, response } = await rpc.handle(c.req.raw, {
      prefix: '/api/rpc',
      context: { deps, headers: c.req.raw.headers, log: c.get('log') },
    })
    if (matched) return c.newResponse(response.body, response)
    await next()
  })

  app.notFound((c) => c.json({ message: 'Not Found' }, 404))
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    // /health is mounted before requestLog, so it has no request logger.
    reportUnexpected(c.get('log') ?? deps.log, deps.errors, err, {
      method: c.req.method,
      path: c.req.path,
    })
    return c.json({ message: 'Internal Server Error' }, 500)
  })
  return app
}

export type App = ReturnType<typeof createApp>
