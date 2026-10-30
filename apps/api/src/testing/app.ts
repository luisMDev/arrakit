import type { Contract } from '@arrakit/contract'
import { type TestData, openTestData } from '@arrakit/db/testing'
import type { Mail } from '@arrakit/emails'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'

import { type App, createApp } from '../app'
import type { StripeGateway } from '../billing/stripe-gateway'
import type { AppDeps } from '../deps'
import { loadApiEnv } from '../env'
import { recordingMailer } from '../mail/mailer'
import { buildDeps } from '../services'

type HeadersLike = ConstructorParameters<typeof Headers>[0]

export const TEST_WEB_ORIGIN = 'http://localhost:4200'

export interface TestApp {
  app: App
  deps: AppDeps
  data: TestData
  sent: Mail[]
  /** oRPC client calling the app in-process; pass Better Auth headers to act as someone. */
  client(headers?: HeadersLike): ContractRouterClient<Contract>
  /** Creates (or reuses) a verified user and returns their session headers (cookie + trusted Origin). */
  signIn(user: { email: string; name?: string }): Promise<{ headers: Headers; userId: string }>
  close(): Promise<void>
}

export async function createTestApp(
  options: { env?: Record<string, string>; stripe?: StripeGateway | null } = {},
): Promise<TestApp> {
  const rawEnv = {
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-00',
    BETTER_AUTH_URL: TEST_WEB_ORIGIN,
    WEB_URL: TEST_WEB_ORIGIN,
    ...options.env,
  }
  const data = await openTestData()
  const { mailer, sent } = recordingMailer()
  const deps = buildDeps({
    env: loadApiEnv(rawEnv),
    rawEnv,
    data,
    mailer,
    stripe: options.stripe ?? null,
    testing: true,
  })
  const app = createApp(deps)

  const client = (headers?: HeadersLike) =>
    createORPCClient<ContractRouterClient<Contract>>(
      new RPCLink({
        url: `${TEST_WEB_ORIGIN}/api/rpc`,
        headers: () => Object.fromEntries(new Headers(headers).entries()),
        fetch: async (request) => app.fetch(request as Request),
      }),
    )

  return {
    app,
    deps,
    data,
    sent,
    client,
    async signIn({ email, name = '' }) {
      const { test } = await deps.auth.$context
      const existing = await test.saveUser(test.createUser({ email, name, emailVerified: true }))
      const { headers } = await test.login({ userId: existing.id })
      headers.set('origin', TEST_WEB_ORIGIN)
      return { headers, userId: existing.id }
    },
    close: () => data.close(),
  }
}
