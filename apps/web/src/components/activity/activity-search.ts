import { z } from 'zod'

export const activitySearch = z.object({
  tab: z.enum(['active', 'finished']).optional().catch(undefined),
})
