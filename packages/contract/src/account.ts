import { z } from 'zod'

import { base, languageSchema, organizationSummarySchema, planSchema } from './common'

export const meSchema = z.object({
  email: z.string(),
  name: z.string(),
  language: languageSchema,
  /** The session's active organization (the earliest joined when none is active). */
  organization: organizationSummarySchema.nullable(),
  /** Better Auth's role string in it: owner, admin, member, a custom role, or several joined by `,`. */
  role: z.string().nullable(),
  /** What the role grants there, by resource (`@arrakit/auth/permissions` statements). */
  permissions: z.record(z.string(), z.array(z.string()).readonly()),
  plan: planSchema.nullable(),
  seats: z.number().int().nullable(),
})
export type Me = z.infer<typeof meSchema>

export const accountViewSchema = z.object({
  name: z.string(),
  email: z.string(),
  signInWith: z.enum(['email', 'google', 'microsoft']),
  devices: z.array(z.string()),
  language: languageSchema,
  timeZone: z.string().nullable(),
  emails: z.object({ productNews: z.boolean() }),
})
export type AccountView = z.infer<typeof accountViewSchema>

export const meContract = {
  get: base.output(meSchema),
  account: {
    get: base.output(accountViewSchema),
  },
}
