import { z } from 'zod'

import { meContract } from './account'
import { billingContract } from './billing'
import { base, moneySchema, organizationSummarySchema, planSchema } from './common'
import { usageContract } from './usage'

const authProvidersSchema = z.object({ google: z.boolean(), microsoft: z.boolean() })
export type AuthProviders = z.infer<typeof authProvidersSchema>

export const createOrganizationSchema = z.object({
  name: z.string().trim().max(200),
  personName: z.string().trim().max(200).optional(),
  termsAccepted: z.literal(true, { error: 'Accept the Terms and the Privacy Policy.' }),
})

const teamMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
})
export type TeamMember = z.infer<typeof teamMemberSchema>

const planOfferSchema = z.object({
  plan: planSchema,
  monthly: moneySchema,
  yearly: moneySchema,
  seats: z.number().int(),
})
export type PlanOfferView = z.infer<typeof planOfferSchema>

export const contract = {
  authProviders: {
    get: base.output(authProvidersSchema),
  },
  me: meContract,
  onboarding: {
    create: base.input(createOrganizationSchema).output(organizationSummarySchema),
    skip: base.output(organizationSummarySchema),
  },
  /** Better Auth lists a team's members only to its own members; this lists them to anyone in the organization. */
  teams: {
    members: base.input(z.object({ teamId: z.string() })).output(z.array(teamMemberSchema)),
  },
  plans: {
    list: base.output(z.array(planOfferSchema)),
  },
  billing: billingContract,
  usage: usageContract,
}

export type Contract = typeof contract

export { organizationSummarySchema } from './common'
export { accountUpdateSchema, type AccountView, type Me } from './account'
export { paidChoiceSchema, type BillingView, type ChangePreview, type PaidChoice } from './billing'
export type { UsageView } from './usage'
