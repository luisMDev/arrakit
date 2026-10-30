import { ACCOUNT_LANGUAGES } from '@arrakit/address'
import { BILLING_CYCLES, METRIC_KEYS, type Metric, PAID_PLANS, PLANS } from '@arrakit/plans'
import { oc } from '@orpc/contract'
import { z } from 'zod'

export const planSchema = z.enum(PLANS)
export const paidPlanSchema = z.enum(PAID_PLANS)
export const billingCycleSchema = z.enum(BILLING_CYCLES)
export const languageSchema = z.enum(ACCOUNT_LANGUAGES)
export const metricSchema = z.enum(METRIC_KEYS as [Metric, ...Metric[]])

/** A calendar day, `YYYY-MM-DD` (UTC). */
export const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
/** Money in minor units. */
export const moneySchema = z.object({ amount: z.number().int(), currency: z.string() })

export const organizationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  plan: planSchema,
})

/**
 * Base contract builder. Every procedure may answer 402 when it spends usage
 * (docs/spec/usage-credits.md 4.2); other errors use ORPCError codes (401/403/404/409/400/502/503).
 */
export const base = oc.errors({
  PAYMENT_REQUIRED: {
    status: 402,
    message: 'Payment required',
    data: z.object({
      metric: metricSchema,
      requested: z.number().int(),
      available: z.number().int(),
    }),
  },
})
