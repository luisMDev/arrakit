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
  get: base.route({ method: 'GET', path: '/health', tags: ['health'] }).output(healthReportSchema),
}
