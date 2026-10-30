import { Hono } from 'hono'
import { RPCHandler } from '@orpc/server/fetch'
import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { contract } from '@arrakit/contract'

import { router } from './router'

/**
 * Builds the Hono app. Layout (docs/spec/platform.md section 4):
 * - GET /health
 * - GET /api/openapi.json
 * - /api/auth/*        Better Auth handler
 * - /api/rpc/*         oRPC
 * - /api/webhooks/stripe, /api/mcp, /.well-known/*  plain Hono routes
 */
export function createApp() {
  const app = new Hono()
  const rpc = new RPCHandler(router)
  const openapi = new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] })

  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.get('/api/openapi.json', async (c) =>
    c.json(
      await openapi.generate(contract, {
        info: { title: 'Arrakit API', version: '1.0.0' },
        servers: [{ url: '/api/rpc' }],
      }),
    ),
  )

  app.use('/api/rpc/*', async (c, next) => {
    const { matched, response } = await rpc.handle(c.req.raw, { prefix: '/api/rpc', context: {} })
    if (matched) return c.newResponse(response.body, response)
    await next()
  })

  app.notFound((c) => c.json({ message: 'Not Found' }, 404))
  return app
}
