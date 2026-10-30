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
export type ChangePreview = z.infer<typeof changePreviewSchema>

export const billingContract = {
  checkout: base
    .input(paidChoiceSchema)
    .output(z.object({ clientSecret: z.string(), publishableKey: z.string() })),
  get: base.output(billingSchema),
  previewChange: base.input(paidChoiceSchema).output(changePreviewSchema),
  change: base.input(paidChoiceSchema).output(billingSchema),
  cancel: base.output(billingSchema),
  resume: base.output(billingSchema),
  portal: base
    .input(z.object({ to: z.enum(['payment', 'details']) }))
    .output(z.object({ url: z.string() })),
}
