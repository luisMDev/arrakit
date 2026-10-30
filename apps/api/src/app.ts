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
import { localFilesRoutes } from './routes/local-files'
import { mcpRoutes } from './routes/mcp'
import { openApiDocument } from './routes/openapi'
import { restRoutes } from './routes/rest'
import { stripeWebhookRoutes } from './routes/stripe-webhook'

export { openApiDocument } from './routes/openapi'

export function createApp(deps: AppDeps) {
  const app = new Hono()
  const rpc = new RPCHandler(router)

  app.route('/', healthRoutes(deps))
  app.use(requestLog(deps.log))
  app.route('/', restRoutes(deps))
  app.get('/api/openapi.json', async (c) => c.json(await openApiDocument()))
  app.route('/', authRoutes(deps))
  app.route('/', stripeWebhookRoutes(deps))
  app.route('/', mcpRoutes(deps))
  app.route('/', localFilesRoutes(deps))

  app.use('/api/rpc/*', async (c, next) => {
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
