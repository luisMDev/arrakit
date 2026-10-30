import { oauthProvider } from '@better-auth/oauth-provider'
import { APIError } from 'better-auth/api'

import { ORGANIZATION_CLAIM, mcpResourceURL } from './config'
import type { AuthDeps } from './deps'

export function connectorProvider(deps: AuthDeps) {
  const { config } = deps
  const resource = mcpResourceURL(config.baseURL)
  return oauthProvider({
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
}
