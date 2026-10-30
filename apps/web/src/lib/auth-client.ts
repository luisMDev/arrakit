import { createArrakitAuthClient } from '@arrakit/auth/client'

// Better Auth client (magic link, organization, OAuth provider plugins). Same origin: /api/auth/*
// is proxied to the API.
export const authClient = createArrakitAuthClient()
