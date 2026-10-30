import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { magicLinkClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const createArrakitAuthClient = () =>
  createAuthClient({
    basePath: '/api/auth',
    plugins: [magicLinkClient(), oauthProviderClient()],
  })
