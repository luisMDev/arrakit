import type { Auth, AuthConfig } from '@arrakit/auth'
import type { ScopedData } from '@arrakit/db'
import type { Mailer } from '@arrakit/emails'

import type { StripeGateway } from './billing/stripe-gateway'
import type { ApiEnv } from './env'
import type { Outbox } from './mail/mailer'

/** Everything the Hono app and the oRPC procedures depend on. Built by main.ts or testing/app.ts. */
export interface AppDeps {
  env: ApiEnv
  data: ScopedData
  auth: Auth
  authConfig: AuthConfig
  mailer: Mailer
  /** Dev/test outbox (console mailer only); exposed at GET /api/dev/outbox outside production. */
  outbox?: Outbox
  /** Null when Stripe is not configured: billing answers 503, the webhook 401. */
  stripe: StripeGateway | null
}
