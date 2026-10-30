import { Hono } from 'hono'

import type { AppDeps } from '../deps'

/** GET /health (not under /api, for the host). */
export function healthRoutes(deps: AppDeps) {
  return new Hono().get('/health', async (c) => {
    const report = await deps.data.health()
    return c.json(report, report.status === 'ok' ? 200 : 503)
  })
}
