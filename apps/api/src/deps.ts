import type { Auth, AuthConfig } from '@arrakit/auth'
import type { ScopedData } from '@arrakit/db'
import type { Mailer } from '@arrakit/emails'

import type { StripeGateway } from './billing/stripe-gateway'
import type { ApiEnv } from './env'

/** Everything the Hono app and the oRPC procedures depend on. Built by main.ts or testing/app.ts. */
export interface AppDeps {
  env: ApiEnv
  data: ScopedData
  auth: Auth
  authConfig: AuthConfig
  mailer: Mailer
  /** Null when Stripe is not configured: billing answers 503, the webhook 401. */
  stripe: StripeGateway | null
}
