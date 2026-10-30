import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { Hono } from 'hono'

import type { AppDeps } from '../deps'
import { procedureContext } from '../orpc/context'
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
 * The REST surface that the OpenAPI document at /api/openapi.json describes
 * (docs/spec/platform.md section 4). It answers only the contract's routes and falls through
 * otherwise, so the routes mounted after it still match.
 */
export function restRoutes(deps: AppDeps) {
  const rest = new OpenAPIHandler(restRouter(served))
  return new Hono().use('/api/*', async (c, next) => {
    const path = c.req.path
    if (NOT_REST.some((prefix) => path.startsWith(prefix))) return next()
    const { matched, response } = await rest.handle(c.req.raw, {
      prefix: '/api',
      context: procedureContext(deps, c.req.raw.headers, c.get('log')),
    })
    if (matched) return c.newResponse(response.body, response)
    await next()
  })
}
