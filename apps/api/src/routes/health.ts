import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { Hono } from 'hono'

import type { AppDeps } from '../deps'
import type { BaseContext } from '../orpc/context'
import { router } from '../router'
import { restRouter } from './openapi'

/**
 * Every procedure but health, served REST-style at the paths the OpenAPI document lists
 * (server `/api`). Health is served at the root only (`GET /health`), so `/api/health` is 404.
 */
const { health: _health, ...served } = router

/** Paths under /api owned by other handlers; the REST handler never reads their bodies. */
const NOT_REST = [
  '/api/rpc/',
  '/api/auth/',
  '/api/webhooks/',
  '/api/mcp',
  '/api/dev/',
  '/api/files/',
]

/**
 * GET /health (not under /api, for the host) and the REST surface that the OpenAPI document at
 * /api/openapi.json describes (docs/spec/platform.md section 4). The REST handler answers only the
 * contract's routes and falls through otherwise, so the routes mounted after it still match.
 */
export function healthRoutes(deps: AppDeps) {
  const rest = new OpenAPIHandler(restRouter(served))
  return new Hono()
    .get('/health', async (c) => {
      const report = await deps.data.health()
      return c.json(report, report.status === 'ok' ? 200 : 503)
    })
    .use('/api/*', async (c, next) => {
      const path = c.req.path
      if (NOT_REST.some((prefix) => path.startsWith(prefix))) return next()
      const context: BaseContext = { deps, data: deps.data, headers: c.req.raw.headers }
      const { matched, response } = await rest.handle(c.req.raw, { prefix: '/api', context })
      if (matched) return c.newResponse(response.body, response)
      await next()
    })
}
