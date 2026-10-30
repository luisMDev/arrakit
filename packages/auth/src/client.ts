import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { createAuthClient } from 'better-auth/react'

export const createArrakitAuthClient = () =>
  createAuthClient({
    basePath: '/api/auth',
    plugins: [oauthProviderClient()],
  })
