import { z } from 'zod'

import {
  base,
  billingCycleSchema,
  daySchema,
  moneySchema,
  paidPlanSchema,
  planSchema,
} from './common'

export const paidChoiceSchema = z.object({ plan: paidPlanSchema, cycle: billingCycleSchema })
export type PaidChoice = z.infer<typeof paidChoiceSchema>

export const billingSchema = z.object({
  plan: planSchema,
  cycle: billingCycleSchema.nullable(),
  renewsOn: daySchema.nullable(),
  endsOn: daySchema.nullable(),
  nextInvoice: moneySchema.nullable(),
  scheduledChange: paidChoiceSchema.extend({ on: daySchema }).nullable(),
  seats: z.number().int(),
  card: z.object({ brand: z.string(), last4: z.string() }).nullable(),
  billingEmail: z.string().min(1).nullable(),
  invoiceTo: z.string(),
  taxId: z.string().min(1).nullable(),
  /** Newest first. */
  invoices: z.array(
    z.object({
      id: z.string(),
      issuedOn: daySchema,
      total: moneySchema,
      status: z.enum(['paid', 'open', 'failed']),
      pdfUrl: z.string().min(1).nullable(),
    }),
  ),
})
export type BillingView = z.infer<typeof billingSchema>

export const changePreviewSchema = z.object({
  applies: z.enum(['now', 'renewal']),
  on: daySchema,
  dueToday: moneySchema,
  nextInvoice: moneySchema,
})

export const billingContract = {
  checkout: base
    .route({ method: 'POST', path: '/billing/checkout', tags: ['billing'] })
    .input(paidChoiceSchema)
    .output(z.object({ clientSecret: z.string(), publishableKey: z.string() })),
  get: base.route({ method: 'GET', path: '/billing', tags: ['billing'] }).output(billingSchema),
  previewChange: base
    .route({ method: 'POST', path: '/billing/change/preview', tags: ['billing'] })
    .input(paidChoiceSchema)
    .output(changePreviewSchema),
  change: base
    .route({ method: 'POST', path: '/billing/change', tags: ['billing'] })
    .input(paidChoiceSchema)
    .output(billingSchema),
  cancel: base
    .route({ method: 'POST', path: '/billing/cancel', tags: ['billing'] })
    .output(billingSchema),
  resume: base
    .route({ method: 'POST', path: '/billing/resume', tags: ['billing'] })
    .output(billingSchema),
  portal: base
    .route({ method: 'POST', path: '/billing/portal', tags: ['billing'] })
    .input(z.object({ to: z.enum(['payment', 'details']) }))
    .output(z.object({ url: z.string() })),
}
