import { createAuthClient } from 'better-auth/react'
import { magicLinkClient, organizationClient } from 'better-auth/client/plugins'

// Better Auth client. Same origin: /api/auth/* is proxied to the API.
export const authClient = createAuthClient({
  plugins: [magicLinkClient(), organizationClient()],
})
