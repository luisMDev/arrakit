import { ORGANIZATION_CLAIM, mcpResourceURL, oauthIssuer } from '@arrakit/auth'
import { verifyJwsAccessToken } from 'better-auth/oauth2'

import type { AppDeps } from '../deps'
import { bearerToken } from './bearer-token'
import type { ConnectorCaller } from './server'

/**
 * The caller an `Authorization` header's access token names, or null when the token is refused
 * (not ours, other audience or issuer, expired, or the person is no longer in that organization).
 * A failure to read the API's own signing keys is rethrown: that is a 500, not a refused token.
 */
export async function verifyAccessToken(
  deps: Pick<AppDeps, 'auth' | 'authConfig' | 'data'>,
  authorization: string | null | undefined,
): Promise<ConnectorCaller | null> {
  const token = bearerToken(authorization)
  if (!token) return null
  const { baseURL } = deps.authConfig

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
      verifyOptions: { issuer: oauthIssuer(baseURL), audience: mcpResourceURL(baseURL) },
    })
  } catch {
    if (keysFailure !== undefined) throw keysFailure
    return null
  }

  const { sub: userId, [ORGANIZATION_CLAIM]: organizationId, client_id: clientId, scope } = claims
  if (typeof userId !== 'string' || typeof organizationId !== 'string') return null
  const membership = await deps.data.memberOf(userId)
  if (!membership || membership.organization.id !== organizationId.toLowerCase()) return null

  return {
    userId,
    organizationId: membership.organization.id,
    role: membership.role,
    organizationSlug: membership.organization.slug,
    clientId: typeof clientId === 'string' ? clientId : '',
    scopes: typeof scope === 'string' ? scope.split(' ').filter(Boolean) : [],
  }
}
