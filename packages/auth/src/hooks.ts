import { isWorkEmail, normalizeEmail } from '@arrakit/address'
import { APIError, createAuthMiddleware } from 'better-auth/api'

import { type AuthConfig, isTrustedOrigin } from './config'

const SIGN_IN_PATHS = new Set(['/sign-in/social', '/sign-in/magic-link'])

const SIGN_IN_FROM_APP = 'Sign in from the app.'
const WORK_EMAIL_REQUIRED = 'Enter a work email, like name@company.com.'

export function beforeHook(config: AuthConfig) {
  return createAuthMiddleware(async (ctx) => {
    if (!SIGN_IN_PATHS.has(ctx.path)) return

    if (!isTrustedOrigin(ctx.headers?.get('origin'), config.trustedOrigins)) {
      throw new APIError('FORBIDDEN', { message: SIGN_IN_FROM_APP })
    }
    if (ctx.path !== '/sign-in/magic-link') return

    const body = (ctx.body ?? {}) as Record<string, unknown>
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : ''
    if (!isWorkEmail(email)) throw new APIError('BAD_REQUEST', { message: WORK_EMAIL_REQUIRED })
    return { context: { body: { ...body, email } } }
  })
}
