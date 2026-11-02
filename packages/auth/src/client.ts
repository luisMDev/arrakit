import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import {
  inferAdditionalFields,
  magicLinkClient,
  organizationClient,
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

import { AUTH_BASE_PATH } from './config'
import { ac, organizationSchema, roles } from './permissions'
import { userFields } from './user-fields'

const fetchOptions = {
  customFetchImpl: (input: string | URL | Request, init?: RequestInit) =>
    globalThis.fetch(input, init),
}

/** The app leaves for a provider or an OAuth client itself (`leave()`), never the client. */
const common = { basePath: AUTH_BASE_PATH, fetchOptions, disableDefaultFetchPlugins: true }

export const createArrakitAuthClient = () =>
  createAuthClient({
    ...common,
    plugins: [
      inferAdditionalFields({ user: userFields }),
      magicLinkClient(),
      organizationClient({
        ac,
        roles,
        teams: { enabled: true },
        dynamicAccessControl: { enabled: true },
        schema: organizationSchema,
      }),
    ],
  })

/**
 * For the connector screens (/oauth/*) only: its plugin adds the page's signed OAuth query to
 * every POST while the page has a query string.
 */
export const createArrakitOAuthClient = () =>
  createAuthClient({ ...common, plugins: [oauthProviderClient()] })
