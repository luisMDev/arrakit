import type { BetterAuthOptions } from 'better-auth'

import { MICROSOFT_UNVERIFIED, type AuthConfig } from './config'

/** Microsoft vouches for the email only through these claims; never `verified_primary_email`. */
export const microsoftVouches = (claims: Record<string, unknown>) =>
  claims.email_verified === true || [true, '1', 'true'].includes(claims.xms_edov as never)

export function socialProviders(config: AuthConfig): BetterAuthOptions['socialProviders'] {
  return {
    ...(config.google ? { google: { ...config.google } } : {}),
    ...(config.microsoft
      ? {
          microsoft: {
            ...config.microsoft,
            tenantId: 'common',
            disableProfilePhoto: true,
            mapProfileToUser: (profile: Record<string, unknown>) => ({
              emailVerified: microsoftVouches(profile),
            }),
          },
        }
      : {}),
  }
}

/** `user.validateUserInfo`: refuse an unvouched Microsoft identity before anything is written. */
export const validateUserInfo: NonNullable<
  NonNullable<BetterAuthOptions['user']>['validateUserInfo']
> = ({ source }) => {
  if (source.oauth?.providerId === 'microsoft' && !microsoftVouches(source.oauth.profile ?? {})) {
    return { error: MICROSOFT_UNVERIFIED }
  }
}
