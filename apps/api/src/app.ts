import { RPCHandler } from '@orpc/server/fetch'
import { Hono } from 'hono'

import type { AppDeps } from './deps'
import type { BaseContext } from './orpc/context'
import { router } from './router'
import { authRoutes } from './routes/auth'
import { healthRoutes } from './routes/health'
import { localFilesRoutes } from './routes/local-files'
import { mcpRoutes } from './routes/mcp'
import { generateOpenApiDocument } from './routes/openapi'
import { stripeWebhookRoutes } from './routes/stripe-webhook'

/** The OpenAPI document generated from the contract alone (no DB, no env). */
export { generateOpenApiDocument as openApiDocument } from './routes/openapi'

/**
 * Builds the Hono app (docs/spec/platform.md section 4):
 * - GET /health
 * - GET /api/openapi.json
 * - /api/auth/*                     Better Auth (+ /.well-known/oauth-authorization-server/api/auth)
 * - /api/rpc/*                      oRPC (@arrakit/contract)
 * - POST /api/webhooks/stripe       Stripe webhook
 * - /api/mcp, /.well-known/oauth-protected-resource/api/mcp   MCP
 * - GET/PUT /api/files/local/*     local storage fallback only
 */
export function createApp(deps: AppDeps) {
  const app = new Hono()
  const rpc = new RPCHandler(router)

  app.route('/', healthRoutes(deps))
  app.get('/api/openapi.json', async (c) => c.json(await generateOpenApiDocument()))
  app.route('/', authRoutes(deps))
  app.route('/', stripeWebhookRoutes(deps))
  app.route('/', mcpRoutes(deps))
  app.route('/', localFilesRoutes(deps))

  app.use('/api/rpc/*', async (c, next) => {
    const context: BaseContext = { deps, data: deps.data, headers: c.req.raw.headers }
    const { matched, response } = await rpc.handle(c.req.raw, { prefix: '/api/rpc', context })
    if (matched) return c.newResponse(response.body, response)
    await next()
  })

  app.notFound((c) => c.json({ message: 'Not Found' }, 404))
  return app
}

export type App = ReturnType<typeof createApp>
