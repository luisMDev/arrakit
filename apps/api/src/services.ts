import { type AuthDeps, createAuth, loadAuthConfig } from '@arrakit/auth'
import { type Data, loadDataConfig, openData } from '@arrakit/db'

import { createStripeGateway, guardedStripe } from './billing/stripe-gateway'
import type { AppDeps } from './deps'
import { loadApiEnv } from './env'
import { createMailer } from './mail/mailer'
import { apiRefusal, organizationDeps } from './organizations/organization-deps'
import { createErrorReporter } from './observability/error-reporter'
import type { Logger } from './observability/logger'
import { taskWatchHub } from './tasks/watch'

type DepsParts = Omit<AppDeps, 'auth' | 'data' | 'taskWatches'> & { data: Data; testing?: boolean }

export function buildDeps(parts: DepsParts): AppDeps {
  const { authConfig, data, log } = parts
  const stripeLog = log.child({ component: 'stripe' })
  const stripe = guardedStripe(parts.stripe, stripeLog)
  const auth = createAuth({
    config: authConfig,
    data,
    mailer: parts.mailer,
    organizations: organizationDeps(
      data,
      guardedStripe(parts.stripe, stripeLog, apiRefusal),
      log.child({ component: 'organizations' }),
    ),
    testing: parts.testing,
    logger: betterAuthLogger(log),
  })
  return {
    env: parts.env,
    data,
    auth,
    authConfig,
    mailer: parts.mailer,
    stripe,
    log,
    errors: parts.errors,
    taskWatches: taskWatchHub(data, log.child({ component: 'tasks' })),
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
 * Boot order: env and auth config, error reporter, mailer,
 * data (refused when its migrations are behind).
 */
export async function depsFromEnv(
  rawEnv: Record<string, string | undefined>,
  log: Logger,
): Promise<AppDeps> {
  const env = loadApiEnv(rawEnv)
  const authConfig = loadAuthConfig(rawEnv)
  const errors = createErrorReporter(env)
  const mailLog = log.child({ component: 'mail' })
  const mailer = createMailer(env, { log: (line) => mailLog.info(line) })
  const data = await openData(loadDataConfig(rawEnv), { log: log.child({ component: 'data' }) })
  return buildDeps({
    env,
    authConfig,
    data,
    mailer,
    stripe: createStripeGateway(env),
    log,
    errors,
  })
}
