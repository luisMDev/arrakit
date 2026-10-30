import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

import { AUTH_BASE_PATH } from './config'
import { ac, organizationSchema, roles } from './permissions'

export const createArrakitAuthClient = () =>
  createAuthClient({
    basePath: AUTH_BASE_PATH,
    fetchOptions: { customFetchImpl: (input, init) => globalThis.fetch(input, init) },
    plugins: [
      oauthProviderClient(),
      organizationClient({
        ac,
        roles,
        teams: { enabled: true },
        dynamicAccessControl: { enabled: true },
        schema: organizationSchema,
      }),
    ],
  })
