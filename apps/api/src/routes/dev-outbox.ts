import { Hono } from 'hono'

import type { AppDeps } from '../deps'

export function devOutboxRoutes(deps: AppDeps) {
  const app = new Hono()
  if (deps.env.NODE_ENV === 'production' || !deps.outbox) return app
  const outbox = deps.outbox
  return app
    .get('/api/dev/outbox', (c) => c.json(outbox.list(c.req.query('to'))))
    .delete('/api/dev/outbox', (c) => {
      outbox.clear()
      return c.body(null, 204)
    })
}
