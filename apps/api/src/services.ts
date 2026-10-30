import { createAuth, loadAuthConfig } from '@arrakit/auth'
import { type Data, loadDataConfig, openData } from '@arrakit/db'
import type { Mailer } from '@arrakit/emails'

import { type StripeGateway, createStripeGateway } from './billing/stripe-gateway'
import type { AppDeps } from './deps'
import { type ApiEnv, loadApiEnv } from './env'
import { type Outbox, createMailer } from './mail/mailer'

export interface DepsParts {
  env: ApiEnv
  rawEnv: Record<string, string | undefined>
  data: Data
  mailer: Mailer
  outbox?: Outbox
  stripe: StripeGateway | null
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
  })
  return {
    env: parts.env,
    data: parts.data,
    auth,
    authConfig,
    mailer: parts.mailer,
    outbox: parts.outbox,
    stripe: parts.stripe,
  }
}

/** Boot order (docs/spec/platform.md 4.1): env and auth config, mailer, data (migrations). */
export async function depsFromEnv(rawEnv: Record<string, string | undefined>): Promise<AppDeps> {
  const env = loadApiEnv(rawEnv)
  loadAuthConfig(rawEnv) // fail the boot, not the first sign-in
  const { mailer, outbox } = createMailer(rawEnv)
  const data = await openData(loadDataConfig(rawEnv))
  return buildDeps({
    env,
    rawEnv,
    data,
    mailer,
    // The outbox keeps sign-in links in memory; only keep it when the dev outbox route is on.
    outbox: env.DEV_OUTBOX === '1' ? outbox : undefined,
    stripe: createStripeGateway(env),
  })
}
