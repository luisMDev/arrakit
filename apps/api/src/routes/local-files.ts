import { Hono } from 'hono'

import type { AppDeps } from '../deps'

/** Presigned URLs of the local/in-memory storage fallback (production always uses S3/R2). */
export function localFilesRoutes(deps: AppDeps) {
  const app = new Hono()
  const serveSigned = deps.data.serveSignedFile
  if (serveSigned) app.on(['GET', 'PUT'], '/api/files/local/*', (c) => serveSigned(c.req.raw))
  return app
}
