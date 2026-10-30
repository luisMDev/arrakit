import { randomUUID } from 'node:crypto'

import { ACCOUNT_LANGUAGES } from '@arrakit/address'
import { APP_NAME } from '@arrakit/emails'
import { betterAuth } from 'better-auth'
import { jwt, magicLink, testUtils } from 'better-auth/plugins'

import { AUTH_BASE_PATH, COOKIE_PREFIX, MAGIC_LINK_MINUTES, oauthIssuer } from './config'
import type { AuthDeps } from './deps'
import { beforeHook } from './hooks'
import { magicLinkSender } from './magic-link'
import { connectorProvider } from './oauth'
import { socialProviders, validateUserInfo } from './social'

export function createAuth(deps: AuthDeps) {
  const { config } = deps
  return betterAuth({
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
    hooks: { before: beforeHook(config) },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_MINUTES * 60,
        storeToken: 'hashed',
        sendMagicLink: magicLinkSender(deps),
      }),
      jwt({ disableSettingJwtHeader: true, jwt: { issuer: oauthIssuer(config.baseURL) } }),
      connectorProvider(deps),
      ...(deps.testing ? [testUtils({ captureOTP: true })] : []),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
