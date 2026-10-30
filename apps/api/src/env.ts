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
})

export type ApiEnv = z.infer<typeof envSchema> & {
  /** Origin of the web app: WEB_URL, else BETTER_AUTH_URL. */
  webUrl: string
}

export function loadApiEnv(env: Record<string, string | undefined>): ApiEnv {
  const parsed = envSchema.parse(env)
  if (parsed.NODE_ENV === 'production' && parsed.STRIPE_FAKE === '1') {
    throw new Error('[api] STRIPE_FAKE=1 is not allowed in production')
  }
  const web = parsed.WEB_URL ?? parsed.BETTER_AUTH_URL ?? 'http://localhost:5200'
  return { ...parsed, webUrl: new URL(web).origin }
}
