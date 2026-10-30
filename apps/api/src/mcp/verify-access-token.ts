import { ORGANIZATION_CLAIM, mcpResourceURL, oauthIssuer } from '@arrakit/auth'
import { verifyJwsAccessToken } from 'better-auth/oauth2'

import type { AppDeps } from '../deps'
import type { ConnectorCaller } from './server'

const BEARER = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i

/**
 * The token68 an `Authorization: Bearer` header carries, or null for any other header.
 * A `?access_token=` query parameter is never read.
 */
export const bearerToken = (header: string | null | undefined): string | null =>
  BEARER.exec(header ?? '')?.[1] ?? null

/**
 * The caller an access token names, or null when the token is refused (not ours, other audience
 * or issuer, expired, or the person is no longer in that organization).
 * A failure to read the API's own signing keys is rethrown: that is a 500, not a refused token.
 */
export async function verifyAccessToken(
  deps: Pick<AppDeps, 'auth' | 'authConfig' | 'data'>,
  token: string,
): Promise<ConnectorCaller | null> {
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
  const membership = await deps.data.membershipIn(userId, organizationId)
  if (!membership) return null

  return {
    organization: membership.organization,
    role: membership.role,
    clientId: typeof clientId === 'string' ? clientId : '',
    scopes: typeof scope === 'string' ? scope.split(' ').filter(Boolean) : [],
  }
}
