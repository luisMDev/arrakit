import { z } from 'zod'

const empty = (value: unknown) => (value === '' ? undefined : value)
const optional = z.preprocess(empty, z.string().optional())

export const envSchema = z.object({
  NODE_ENV: z.preprocess(
    empty,
    z.enum(['development', 'test', 'production']).default('development'),
  ),
  PORT: z.preprocess(empty, z.coerce.number().int().positive().default(3000)),
  BETTER_AUTH_URL: optional,
  WEB_URL: optional,
  RESEND_API_KEY: optional,
  MAIL_FROM: z.preprocess(empty, z.string().default('Arrakit <hello@example.com>')),
  STRIPE_SECRET_KEY: optional,
  STRIPE_PUBLISHABLE_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  /** `1` uses the in-memory fake Stripe gateway (dev and e2e). Never in production. */
  STRIPE_FAKE: z.preprocess(empty, z.enum(['0', '1']).default('0')),
  /**
   * `1` serves the in-memory dev outbox at /api/dev/outbox (unauthenticated, it shows sign-in
   * links). Off unless set explicitly; on by default only when NODE_ENV=test (vitest, e2e).
   * Never in production.
   */
  DEV_OUTBOX: z.preprocess(empty, z.enum(['0', '1']).optional()),
})

export type ApiEnv = Omit<z.infer<typeof envSchema>, 'DEV_OUTBOX'> & {
  DEV_OUTBOX: '0' | '1'
  /** Origin of the web app: WEB_URL, else BETTER_AUTH_URL. */
  webUrl: string
}

export function loadApiEnv(env: Record<string, string | undefined>): ApiEnv {
  const parsed = envSchema.parse(env)
  if (parsed.NODE_ENV === 'production' && parsed.STRIPE_FAKE === '1') {
    throw new Error('[api] STRIPE_FAKE=1 is not allowed in production')
  }
  if (parsed.NODE_ENV === 'production' && parsed.DEV_OUTBOX === '1') {
    throw new Error('[api] DEV_OUTBOX=1 is not allowed in production')
  }
  const devOutbox = parsed.DEV_OUTBOX ?? (parsed.NODE_ENV === 'test' ? '1' : '0')
  const web = parsed.WEB_URL ?? parsed.BETTER_AUTH_URL ?? 'http://localhost:4200'
  return { ...parsed, DEV_OUTBOX: devOutbox, webUrl: new URL(web).origin }
}
