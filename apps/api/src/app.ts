import { contract } from '@arrakit/contract'
import { OpenAPIGenerator } from '@orpc/openapi'
import { RPCHandler } from '@orpc/server/fetch'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { Hono } from 'hono'

import type { AppDeps } from './deps'
import type { BaseContext } from './orpc/context'
import { router } from './router'
import { authRoutes } from './routes/auth'
import { devOutboxRoutes } from './routes/dev-outbox'
import { healthRoutes } from './routes/health'
import { mcpRoutes } from './routes/mcp'
import { stripeWebhookRoutes } from './routes/stripe-webhook'

/** The OpenAPI document generated from the contract alone (no DB, no env). */
export async function openApiDocument() {
  const document = await new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  }).generate(contract, {
    info: { title: 'Arrakit API', version: '1.0.0' },
    servers: [{ url: '/api' }],
  })
  // /health answers 503 with the same body as 200 when a probe is down; the contract cannot say so.
  const health = document.paths?.['/health']?.get
  const ok = health?.responses?.['200']
  if (health?.responses && ok) {
    health.responses['503'] = { ...ok, description: 'A dependency is down' }
  }
  return document
}

/**
 * Builds the Hono app (docs/spec/platform.md section 4):
 * - GET /health
 * - GET /api/openapi.json
 * - /api/auth/*                     Better Auth (+ /.well-known/oauth-authorization-server/api/auth)
 * - /api/rpc/*                      oRPC (@arrakit/contract)
 * - POST /api/webhooks/stripe       Stripe webhook
 * - /api/mcp, /.well-known/oauth-protected-resource/api/mcp   MCP
 * - GET /api/dev/outbox             dev/e2e only
 */
export function createApp(deps: AppDeps) {
  const app = new Hono()
  const rpc = new RPCHandler(router)

  app.route('/', healthRoutes(deps))
  app.get('/api/openapi.json', async (c) => c.json(await openApiDocument()))
  app.route('/', authRoutes(deps))
  app.route('/', stripeWebhookRoutes(deps))
  app.route('/', mcpRoutes(deps))
  app.route('/', devOutboxRoutes(deps))

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
