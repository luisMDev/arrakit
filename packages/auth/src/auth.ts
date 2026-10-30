import { randomUUID } from 'node:crypto'

import { ACCOUNT_LANGUAGES } from '@arrakit/address'
import { APP_NAME } from '@arrakit/emails'
import { betterAuth } from 'better-auth'
import { jwt, magicLink, testUtils } from 'better-auth/plugins'

import { AUTH_BASE_PATH, COOKIE_PREFIX, MAGIC_LINK_MINUTES, oauthIssuer } from './config'
import type { AuthDeps } from './deps'
import { afterHook, beforeHook } from './hooks'
import { magicLinkSender } from './magic-link'
import { connectorProvider } from './oauth'
import { type JoinLinkSender, organizationPlugin } from './organization'
import { socialProviders, validateUserInfo } from './social'

export function createAuth(deps: AuthDeps) {
  const { config, organizations } = deps
  const links: { send?: JoinLinkSender } = {}
  const unsentInvitations = new Set<string>()
  const auth = betterAuth({
    appName: APP_NAME,
    baseURL: config.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: deps.database,
    emailAndPassword: { enabled: false },
    disabledPaths: ['/token'],
    socialProviders: socialProviders(config),
    user: {
      additionalFields: {
        language: { type: [...ACCOUNT_LANGUAGES], defaultValue: 'en', input: false },
      },
      // Only Microsoft needs it. Note: with it set, testUtils.saveUser() must run inside an
      // endpoint context, so tests that configure Microsoft create users through the API instead.
      ...(config.microsoft ? { validateUserInfo } : {}),
    },
    session: { cookieCache: { enabled: true, maxAge: 300 } },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => ({
            data: {
              ...session,
              activeOrganizationId: await organizations.defaultOf(session.userId),
            },
          }),
        },
      },
    },
    account: { encryptOAuthTokens: true, accountLinking: { trustedProviders: [] } },
    telemetry: { enabled: false },
    ...(deps.logger ? { logger: deps.logger } : {}),
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      // Spelled out: Better Auth skips origin checks when NODE_ENV=test; tests run the real checks.
      disableOriginCheck: false,
      ipAddress: { ipAddressHeaders: ['x-real-ip', 'x-forwarded-for'] },
      database: { generateId: () => randomUUID() },
    },
    hooks: { before: beforeHook(config), after: afterHook(organizations, unsentInvitations) },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_MINUTES * 60,
        storeToken: 'hashed',
        sendMagicLink: magicLinkSender(deps),
      }),
      jwt({ disableSettingJwtHeader: true, jwt: { issuer: oauthIssuer(config.baseURL) } }),
      organizationPlugin(deps, links, unsentInvitations),
      connectorProvider(deps),
      ...(deps.testing ? [testUtils({ captureOTP: true })] : []),
    ],
  })
  links.send = async (email, joinURL) => {
    await auth.api.signInMagicLink({
      body: { email, callbackURL: joinURL, errorCallbackURL: joinURL },
      headers: new Headers({ origin: config.webOrigin }),
    })
  }
  return auth
}

export type Auth = ReturnType<typeof createAuth>
