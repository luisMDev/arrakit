import { TOP_UP } from '@arrakit/plans'
import { z } from 'zod'

import { base } from './common'

export const topUpContract = {
  topUp: base
    .input(z.object({ cents: z.number().int().min(TOP_UP.minCents).max(TOP_UP.maxCents) }))
    .output(z.object({ url: z.string() })),
}
