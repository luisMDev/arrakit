import { type AuthDeps, createAuth, loadAuthConfig } from '@arrakit/auth'
import { type Data, loadDataConfig, openData } from '@arrakit/db'
import type { Mailer } from '@arrakit/emails'

import { type StripeGateway, createStripeGateway } from './billing/stripe-gateway'
import type { AppDeps } from './deps'
import { type ApiEnv, loadApiEnv } from './env'
import { createMailer } from './mail/mailer'
import { type ErrorReporter, createErrorReporter } from './observability/error-reporter'
import type { Logger } from './observability/logger'

export interface DepsParts {
  env: ApiEnv
  rawEnv: Record<string, string | undefined>
  data: Data
  mailer: Mailer
  stripe: StripeGateway | null
  log: Logger
  errors: ErrorReporter
  testing?: boolean
}

export function buildDeps(parts: DepsParts): AppDeps {
  const authConfig = loadAuthConfig(parts.rawEnv)
  const auth = createAuth({
    config: authConfig,
    database: parts.data.authDatabase,
    mailer: parts.mailer,
    invitationFor: (id, email) => parts.data.invitationFor(id, email),
    organizationOf: (userId) => parts.data.organizationOf(userId),
    testing: parts.testing,
    logger: betterAuthLogger(parts.log),
  })
  return {
    env: parts.env,
    data: parts.data,
    auth,
    authConfig,
    mailer: parts.mailer,
    stripe: parts.stripe,
    log: parts.log,
    errors: parts.errors,
  }
}

const BETTER_AUTH_LEVELS = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
} as const

/**
 * Better Auth's own messages (failed callbacks, adapter errors) through the app logger, filtered
 * by Better Auth at the logger's level so it does not format what would be dropped.
 */
function betterAuthLogger(log: Logger): NonNullable<AuthDeps['logger']> {
  const auth = log.child({ component: 'auth' })
  return {
    disabled: log.level === 'silent',
    level: BETTER_AUTH_LEVELS[log.level as keyof typeof BETTER_AUTH_LEVELS],
    log: (level, message, ...args) => {
      const err = args.find((arg) => arg instanceof Error)
      auth[level](err ? { err } : args.length ? { args } : {}, message)
    },
  }
}

/**
 * Boot order (docs/spec/platform.md 4.1): env and auth config, error reporter, mailer,
 * data (migrations).
 */
export async function depsFromEnv(
  rawEnv: Record<string, string | undefined>,
  log: Logger,
): Promise<AppDeps> {
  const env = loadApiEnv(rawEnv)
  loadAuthConfig(rawEnv) // fail the boot, not the first sign-in
  const errors = createErrorReporter(env)
  const mailLog = log.child({ component: 'mail' })
  const mailer = createMailer(rawEnv, { log: (line) => mailLog.info(line) })
  const data = await openData(loadDataConfig(rawEnv), { log: log.child({ component: 'data' }) })
  return buildDeps({
    env,
    rawEnv,
    data,
    mailer,
    stripe: createStripeGateway(env),
    log,
    errors,
  })
}
