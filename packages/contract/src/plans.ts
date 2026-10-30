import { z } from 'zod'

import { base, moneySchema, planSchema } from './common'

export const planOfferSchema = z.object({
  plan: planSchema,
  monthly: moneySchema,
  yearly: moneySchema,
  seats: z.number().int(),
})
export type PlanOfferView = z.infer<typeof planOfferSchema>

export const plansContract = {
  list: base.output(z.array(planOfferSchema)),
}
