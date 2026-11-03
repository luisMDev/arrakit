import { ORGANIZATION_CLAIM, mcpResourceURL, oauthIssuer } from '@arrakit/auth'
import {
  type AuthInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server'
import { verifyJwsAccessToken } from 'better-auth/oauth2'

import type { AppDeps } from '../deps'
import { grantedTo } from '../orpc/context'
import type { ConnectorCaller } from './server'

/** Runs `load` on the first call only; later calls share its promise. */
const once = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let loaded: Promise<T> | undefined
  return () => (loaded ??= load())
}

const refused = () => new OAuthError(OAuthErrorCode.InvalidToken, 'The access token is refused')

/**
 * Accepts only our own access tokens for the MCP resource, from a person still in the
 * organization the token names; `authInfo.extra` carries who they are there (a ConnectorCaller).
 * Any refusal throws `invalid_token`. A failure to read the API's own signing keys is rethrown
 * as is: that is a 500, not a refused token.
 */
export function accessTokenVerifier(
  deps: Pick<AppDeps, 'auth' | 'authConfig' | 'data'>,
): OAuthTokenVerifier {
  const { baseURL } = deps.authConfig
  const resource = mcpResourceURL(baseURL)

  return {
    async verifyAccessToken(token): Promise<AuthInfo> {
      let keysFailure: unknown
      let claims: Record<string, unknown>
      try {
        claims = await verifyJwsAccessToken(token, {
          jwksFetch: () =>
            deps.auth.api.getJwks().catch((err: unknown) => {
              keysFailure = err
              throw err
            }),
          jwksCacheKey: deps.auth,
          verifyOptions: { issuer: oauthIssuer(baseURL), audience: resource },
        })
      } catch {
        if (keysFailure !== undefined) throw keysFailure
        throw refused()
      }

      const { sub: userId, [ORGANIZATION_CLAIM]: organizationId, client_id, scope, exp } = claims
      if (typeof userId !== 'string' || typeof organizationId !== 'string') throw refused()
      const membership = await deps.data.membershipIn(userId, organizationId)
      if (!membership) throw refused()
      const organizationScope = deps.data.forOrganization(membership.organization.id)

      return {
        token,
        clientId: typeof client_id === 'string' ? client_id : '',
        scopes: typeof scope === 'string' ? scope.split(' ').filter(Boolean) : [],
        expiresAt: typeof exp === 'number' ? exp : undefined,
        resource: new URL(resource),
        extra: {
          userId,
          organization: membership.organization,
          role: membership.role,
          permissions: once(() => grantedTo(membership.role, organizationScope)),
          scope: organizationScope,
        } satisfies ConnectorCaller,
      }
    },
  }
}
