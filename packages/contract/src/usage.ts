import { CURRENCY, METRIC_KINDS } from '@arrakit/plans'
import { z } from 'zod'

import { base, daySchema, metricSchema } from './common'

const metricUsageSchema = z.object({
  metric: metricSchema,
  kind: z.enum(METRIC_KINDS),
  granted: z.number().int(),
  plan: z.number().int(),
  purchased: z.number().int(),
  used: z.number().int(),
  available: z.number().int(),
  limit: z.number().int().min(0).nullable(),
  resetsOn: daySchema,
})

const usageSchema = z.object({
  currency: z.literal(CURRENCY),
  metrics: z.array(metricUsageSchema),
  /** Newest first. */
  topUps: z.array(
    z.object({
      paidOn: daySchema,
      cents: z.number().int(),
      amounts: z.array(z.object({ metric: metricSchema, amount: z.number().int() })),
    }),
  ),
})
export type UsageView = z.infer<typeof usageSchema>

export const usageContract = {
  get: base.output(usageSchema),
}
