import { z } from 'zod'

import { base } from './common'

export const authProvidersContract = {
  /** Public: which social sign-in buttons to show. */
  get: base
    .route({ method: 'GET', path: '/auth-providers', tags: ['auth'] })
    .output(z.object({ google: z.boolean(), microsoft: z.boolean() })),
}
