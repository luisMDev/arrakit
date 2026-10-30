import { Hono } from 'hono'

import type { AppDeps } from '../deps'

/**
 * GET/DELETE /api/dev/outbox: the mail the console mailer kept. It exposes sign-in links without
 * authentication, so it exists only with DEV_OUTBOX=1 (default on only under NODE_ENV=test),
 * never in production and never because NODE_ENV happens to be `development`.
 */
export function devOutboxRoutes(deps: AppDeps) {
  const app = new Hono()
  // Presigned URLs of the local/in-memory storage fallback (production always uses S3/R2).
  const serveSigned = deps.data.serveSignedFile
  if (serveSigned) app.on(['GET', 'PUT'], '/api/files/local/*', (c) => serveSigned(c.req.raw))
  if (deps.env.NODE_ENV === 'production' || deps.env.DEV_OUTBOX !== '1' || !deps.outbox) return app
  const outbox = deps.outbox
  return app
    .get('/api/dev/outbox', (c) => c.json(outbox.list(c.req.query('to'))))
    .delete('/api/dev/outbox', (c) => {
      outbox.clear()
      return c.body(null, 204)
    })
}
