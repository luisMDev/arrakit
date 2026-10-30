import { z } from 'zod'

const empty = (value: unknown) => (value === '' ? undefined : value)
const optional = z.preprocess(empty, z.string().optional())

export const envSchema = z.object({
  NODE_ENV: z.preprocess(
    empty,
    z.enum(['development', 'test', 'production']).default('development'),
  ),
  PORT: z.preprocess(empty, z.coerce.number().int().positive().default(5000)),
  BETTER_AUTH_URL: optional,
  WEB_URL: optional,
  RESEND_API_KEY: optional,
  MAIL_FROM: z.preprocess(empty, z.string().default('Arrakit <hello@example.com>')),
  STRIPE_SECRET_KEY: optional,
  STRIPE_PUBLISHABLE_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  /** `1` uses the in-memory fake Stripe gateway (dev and e2e). Never in production. */
  STRIPE_FAKE: z.preprocess(empty, z.enum(['0', '1']).default('0')),
  /** Mailpit's HTTP origin (dev and e2e): mail goes there when RESEND_API_KEY is unset. */
  MAILPIT_URL: optional,
  /** Pino level; `silent` turns logging off. Defaults to `silent` in tests, `info` otherwise. */
  LOG_LEVEL: z.preprocess(
    empty,
    z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).optional(),
  ),
  /** `json` (one object per line) or `pretty` (pino-pretty, dev only). Defaults to `pretty` in development. */
  LOG_FORMAT: z.preprocess(empty, z.enum(['json', 'pretty']).optional()),
  /** Sentry project DSN; without it errors are only logged. */
  SENTRY_DSN: optional,
  /** Defaults to NODE_ENV. */
  SENTRY_ENVIRONMENT: optional,
  SENTRY_RELEASE: optional,
})

export type ApiEnv = z.infer<typeof envSchema> & {
  /** Origin of the web app: WEB_URL, else BETTER_AUTH_URL. */
  webUrl: string
}

const logSchema = envSchema.pick({ NODE_ENV: true, LOG_LEVEL: true, LOG_FORMAT: true })

export interface LogEnv {
  LOG_LEVEL: NonNullable<ApiEnv['LOG_LEVEL']>
  LOG_FORMAT: NonNullable<ApiEnv['LOG_FORMAT']>
}

/** Only the logging variables, so the boot can log a failure to parse the rest. */
export function loadLogEnv(env: Record<string, string | undefined>): LogEnv {
  const parsed = logSchema.parse(env)
  return {
    LOG_LEVEL: parsed.LOG_LEVEL ?? (parsed.NODE_ENV === 'test' ? 'silent' : 'info'),
    LOG_FORMAT: parsed.LOG_FORMAT ?? (parsed.NODE_ENV === 'development' ? 'pretty' : 'json'),
  }
}

export function loadApiEnv(env: Record<string, string | undefined>): ApiEnv {
  const parsed = envSchema.parse(env)
  if (parsed.NODE_ENV === 'production' && parsed.STRIPE_FAKE === '1') {
    throw new Error('[api] STRIPE_FAKE=1 is not allowed in production')
  }
  const web = parsed.WEB_URL ?? parsed.BETTER_AUTH_URL ?? 'http://localhost:5200'
  return { ...parsed, webUrl: new URL(web).origin }
}
