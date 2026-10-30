import { oc } from '@orpc/contract'
import { z } from 'zod'

const probe = z.enum(['up', 'down'])
export const healthReportSchema = z.object({
  status: z.enum(['ok', 'error']),
  postgres: probe,
  storage: probe,
  queue: probe,
})

export const healthContract = {
  get: oc
    .route({
      method: 'GET',
      path: '/health',
      tags: ['health'],
      // Served at the root (GET /health, for the host), not under the document's /api server.
      // A probe down answers 503 with the same body, which an output schema cannot say.
      spec: (operation) => {
        const ok = operation.responses?.['200']
        return {
          ...operation,
          servers: [{ url: '/' }],
          responses: {
            ...operation.responses,
            ...(ok && { '503': { ...ok, description: 'A dependency is down' } }),
          },
        }
      },
    })
    .output(healthReportSchema),
}
