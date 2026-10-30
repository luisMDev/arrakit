import { isTimeZone } from '@arrakit/address'
import { z } from 'zod'

import { base, languageSchema, organizationSummarySchema, planSchema, roleSchema } from './common'

export const meSchema = z.object({
  email: z.string(),
  name: z.string(),
  language: languageSchema,
  organization: organizationSummarySchema.nullable(),
  role: roleSchema.nullable(),
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

export const accountUpdateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter your name.')
    .max(100, 'Keep your name to 100 characters.')
    .regex(/^[^\p{Cc}\u2028\u2029]*$/u, 'Keep your name on one line.')
    .optional(),
  language: languageSchema.optional(),
  timeZone: z.string().refine(isTimeZone, 'Pick a time zone from the list.').optional(),
  emails: z.object({ productNews: z.boolean() }).partial().optional(),
})

export const meContract = {
  get: base.route({ method: 'GET', path: '/me', tags: ['me'] }).output(meSchema),
  delete: base.route({ method: 'DELETE', path: '/me', tags: ['me'] }).output(z.void()),
  account: {
    get: base.route({ method: 'GET', path: '/me/account', tags: ['me'] }).output(accountViewSchema),
    update: base
      .route({ method: 'PATCH', path: '/me/account', tags: ['me'] })
      .input(accountUpdateSchema)
      .output(accountViewSchema),
  },
}
