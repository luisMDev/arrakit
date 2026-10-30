import { isTrustedOrigin } from '@arrakit/auth'
import { ORPCError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

import type { AppDeps } from './deps'
import { requestLog } from './observability/request-log'
import { reportUnexpected } from './observability/unexpected-error'
import { procedureContext } from './orpc/context'
import { router } from './router'
import { authRoutes } from './routes/auth'
import { healthRoutes } from './routes/health'
import { mcpRoutes } from './routes/mcp'
import { stripeWebhookRoutes } from './routes/stripe-webhook'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function createApp(deps: AppDeps) {
  const app = new Hono()
  const rpc = new RPCHandler(router)

  app.route('/', healthRoutes(deps))
  app.use(requestLog(deps.log))
  app.route('/', authRoutes(deps))
  app.route('/', stripeWebhookRoutes(deps))
  app.route('/', mcpRoutes(deps))

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
      context: procedureContext(deps, c.req.raw.headers, c.get('log')),
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
