import { oauthProvider } from '@better-auth/oauth-provider'
import { APIError } from 'better-auth/api'

import { ORGANIZATION_CLAIM, mcpResourceURL } from './config'
import type { AuthDeps } from './deps'

/**
 * The web server proxies /api with fetch, which rewrites `sec-fetch-mode` to `cors`. The OAuth
 * provider reads that as a script's fetch and answers a page navigation (authorize, opened by the
 * browser) with JSON instead of a redirect. A `document` destination is always a navigation.
 */
export function restoreNavigation(request: Request): Request | undefined {
  const isGet = request.method === 'GET' || request.method === 'HEAD'
  const headers = request.headers
  if (!isGet || headers.get('sec-fetch-dest') !== 'document') return undefined
  if (headers.get('sec-fetch-mode') === 'navigate') return undefined
  const restored = new Headers(headers)
  restored.set('sec-fetch-mode', 'navigate')
  return new Request(request.url, { method: request.method, headers: restored })
}

export function connectorProvider(deps: AuthDeps) {
  const { config } = deps
  const resource = mcpResourceURL(config.baseURL)
  const provider = oauthProvider({
    loginPage: `${config.webOrigin}/oauth/signin`,
    consentPage: `${config.webOrigin}/oauth/consent`,
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    grantTypes: ['authorization_code', 'refresh_token'],
    resources: [resource],
    clientRegistrationDefaultResources: [resource],
    postLogin: {
      page: `${config.webOrigin}/oauth/consent`,
      shouldRedirect: async ({ user }) => (await deps.organizationOf(user.id)) === null,
      consentReferenceId: async ({ user }) => {
        const organization = await deps.organizationOf(user.id)
        if (!organization) {
          throw new APIError('FORBIDDEN', {
            error: 'access_denied',
            error_description: 'You are not in an organization here.',
          })
        }
        return organization.id
      },
    },
    customAccessTokenClaims: ({ referenceId }) =>
      referenceId ? { [ORGANIZATION_CLAIM]: referenceId } : {},
  })
  return {
    ...provider,
    onRequest: async (request: Request, ctx: Parameters<typeof provider.onRequest>[1]) => {
      const answered = await provider.onRequest(request, ctx)
      if (answered) return answered
      const restored = restoreNavigation(request)
      return restored ? { request: restored } : undefined
    },
  }
}
