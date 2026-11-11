import type { Auth, AuthConfig } from '@arrakit/auth'
import type { ScopedData } from '@arrakit/db'
import type { Mailer } from '@arrakit/emails'

import type { StripeGateway } from './billing/stripe-gateway'
import type { ApiEnv } from './env'
import type { ErrorReporter } from './observability/error-reporter'
import type { Logger } from './observability/logger'
import type { TaskWatchHub } from './tasks/watch'

/** Everything the Hono app and the oRPC procedures depend on. Built by main.ts or testing/app.ts. */
export interface AppDeps {
  env: ApiEnv
  data: ScopedData
  auth: Auth
  authConfig: AuthConfig
  mailer: Mailer
  /** Unconfigured without Stripe keys: billing answers 503, the webhook 401. */
  stripe: StripeGateway
  log: Logger
  /** Unexpected errors go here (Sentry when SENTRY_DSN is set). */
  errors: ErrorReporter
  /** Who watches which organization's tasks in this process. */
  taskWatches: TaskWatchHub
}
