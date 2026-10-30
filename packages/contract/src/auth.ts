import { z } from 'zod'

import { base } from './common'

export const authProvidersSchema = z.object({ google: z.boolean(), microsoft: z.boolean() })
export type AuthProviders = z.infer<typeof authProvidersSchema>

export const authProvidersContract = {
  get: base
    .route({ method: 'GET', path: '/auth-providers', tags: ['auth'] })
    .output(authProvidersSchema),
}
