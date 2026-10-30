import { drizzleAdapter } from 'better-auth/adapters/drizzle'

import type { Database } from './connection'
import * as schema from './schema/index'

export function authDatabase(db: Database) {
  return drizzleAdapter(db, {
    provider: 'pg',
    usePlural: true,
    transaction: true,
    schema: {
      users: schema.users,
      sessions: schema.sessions,
      accounts: schema.accounts,
      verifications: schema.verifications,
      // Plural of the jwt plugin's `jwks` model.
      jwkss: schema.jwks,
      oauthClients: schema.oauthClients,
      oauthResources: schema.oauthResources,
      oauthClientResources: schema.oauthClientResources,
      oauthRefreshTokens: schema.oauthRefreshTokens,
      oauthAccessTokens: schema.oauthAccessTokens,
      oauthConsents: schema.oauthConsents,
      oauthClientAssertions: schema.oauthClientAssertions,
    },
  })
}

export type AuthDatabase = ReturnType<typeof authDatabase>
