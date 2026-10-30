import { z } from 'zod'

import { base } from './common'

const probe = z.enum(['up', 'down'])
export const healthReportSchema = z.object({
  status: z.enum(['ok', 'error']),
  postgres: probe,
  storage: probe,
  queue: probe,
})

export const healthContract = {
  get: base
    .route({
      method: 'GET',
      path: '/health',
      tags: ['health'],
      // The document's server is /api, but health is served at the root (GET /health, for the host).
      spec: (operation) => ({ ...operation, servers: [{ url: '/' }] }),
    })
    .output(healthReportSchema),
}
