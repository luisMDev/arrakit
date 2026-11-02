import { randomUUID } from 'node:crypto'

import { APP_NAME } from '@arrakit/emails'
import { betterAuth } from 'better-auth'
import { jwt, magicLink, testUtils } from 'better-auth/plugins'

import type { ScopedData } from '@arrakit/db'
import type { Mailer } from '@arrakit/emails'
import type { BetterAuthOptions } from 'better-auth'

import {
  AUTH_BASE_PATH,
  type AuthConfig,
  COOKIE_PREFIX,
  MAGIC_LINK_MINUTES,
  oauthIssuer,
} from './config'
import { type InvitationLinks, afterHook, beforeHook } from './hooks'
import { magicLinkSender } from './magic-link'
import { connectorProvider } from './oauth'
import { organizationPlugin } from './organization'
import { socialProviders, validateUserInfo } from './social'
import { deleteUser } from './user'
import { userFields } from './user-fields'

/** What Better Auth's rules read from the data layer. */
type AuthData = Pick<
  ScopedData,
  | 'authDatabase'
  | 'memberOf'
  | 'membershipIn'
  | 'invitationFor'
  | 'revokeGrants'
  | 'clearForAccountDeletion'
  | 'forOrganization'
>

/** What the organization plugin's rules need from the app beyond the data layer. */
export interface OrganizationDeps {
  /** The plan's seats, and the refusal when they are all taken. */
  seats(organization: Record<string, unknown>): { limit: number; full: string }
  /** Runs before an organization is deleted; throwing an APIError keeps it. */
  beforeDelete(organizationId: string): Promise<void>
  afterDelete(organizationId: string): Promise<void>
  log: { error(fields: Record<string, unknown>, message: string): void }
}

export interface AuthDeps {
  config: AuthConfig
  data: AuthData
  mailer: Mailer
  organizations: OrganizationDeps
  /** Where Better Auth writes its own messages (its console logger when unset). */
  logger?: BetterAuthOptions['logger']
  /** Adds Better Auth's testUtils plugin (tests only). */
  testing?: boolean
}

export function createAuth(deps: AuthDeps) {
  const { config, data } = deps
  const links: InvitationLinks = {}
  const auth = betterAuth({
    appName: APP_NAME,
    baseURL: config.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: data.authDatabase,
    emailAndPassword: { enabled: false },
    disabledPaths: ['/token'],
    socialProviders: socialProviders(config),
    user: {
      additionalFields: userFields,
      deleteUser: deleteUser(data),
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
              activeOrganizationId: (await data.memberOf(session.userId))?.organization.id ?? null,
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
    hooks: { before: beforeHook(config, data), after: afterHook(deps, links) },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_MINUTES * 60,
        storeToken: 'hashed',
        sendMagicLink: magicLinkSender(deps),
      }),
      jwt({ disableSettingJwtHeader: true, jwt: { issuer: oauthIssuer(config.baseURL) } }),
      organizationPlugin(deps),
      connectorProvider(deps),
      ...(deps.testing ? [testUtils({ captureOTP: true })] : []),
    ],
  })
  links.send = async (email, invitationId) => {
    const joinURL = `${config.webOrigin}/join/${encodeURIComponent(invitationId)}`
    await auth.api.signInMagicLink({
      body: { email, callbackURL: joinURL, errorCallbackURL: joinURL, metadata: { invitationId } },
      headers: new Headers(),
    })
  }
  return auth
}

export type Auth = ReturnType<typeof createAuth>
