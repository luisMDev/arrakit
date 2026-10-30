import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { magicLinkClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export function createArrakitAuthClient(options: { baseURL?: string } = {}) {
  return createAuthClient({
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    basePath: '/api/auth',
    plugins: [magicLinkClient(), organizationClient(), oauthProviderClient()],
  })
}

export type ArrakitAuthClient = ReturnType<typeof createArrakitAuthClient>
