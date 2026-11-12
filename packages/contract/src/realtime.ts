import { z } from 'zod'

import { base } from './common'

export const realtimeAccessSchema = z.object({
  url: z.url(),
  publishableKey: z.string(),
  /** Supabase accepts it until `expiresAt`; ask again before then. */
  token: z.string(),
  expiresAt: z.iso.datetime(),
  /** The private topics the caller may join. */
  topics: z.object({ tasks: z.string() }),
})
export type RealtimeAccess = z.infer<typeof realtimeAccessSchema>

export const realtimeContract = {
  /** How to reach Supabase Realtime as the caller; null when the API has no Supabase project to offer. */
  access: base.output(realtimeAccessSchema.nullable()),
}
