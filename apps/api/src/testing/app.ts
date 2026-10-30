import { loadAuthConfig } from '@arrakit/auth'
import type { Contract } from '@arrakit/contract'
import { openTestData } from '@arrakit/db/testing'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'

import { createApp } from '../app'
import { FAKE_STRIPE_SIGNATURE } from '../billing/fake-stripe'
import { type StripeGateway, unconfiguredStripe } from '../billing/stripe-gateway'
import { loadApiEnv } from '../env'
import { recordingMailer } from '../mail/mailer'
import { recordingErrorReporter } from '../observability/error-reporter'
import { recordingLogger } from '../observability/logger'
import type { BaseContext } from '../orpc/context'
import { buildDeps } from '../services'

type HeadersLike = ConstructorParameters<typeof Headers>[0]

export const TEST_WEB_ORIGIN = 'http://localhost:5200'

/** `headers` sent from the app's origin unless they name another one. */
export function withOrigin(headers?: HeadersLike): Headers {
  const sent = new Headers(headers)
  if (!sent.has('origin')) sent.set('origin', TEST_WEB_ORIGIN)
  return sent
}

/** The `name=value` of the session cookie a response sets, if any. */
export const sessionCookieOf = (res: Response): string | undefined =>
  res.headers
    .getSetCookie()
    .find((cookie) => /session_token=[^;]+/.test(cookie))
    ?.split(';')[0]

export type TestApp = Awaited<ReturnType<typeof createTestApp>>

export async function createTestApp(
  options: { env?: Record<string, string>; stripe?: StripeGateway } = {},
) {
  const rawEnv = {
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-00',
    BETTER_AUTH_URL: TEST_WEB_ORIGIN,
    WEB_URL: TEST_WEB_ORIGIN,
    ...options.env,
  }
  const { log, logs } = recordingLogger()
  const data = await openTestData({ log })
  const { mailer, sent } = recordingMailer()
  const { errors, captured } = recordingErrorReporter()
  const deps = buildDeps({
    env: loadApiEnv(rawEnv),
    authConfig: loadAuthConfig(rawEnv),
    data,
    mailer,
    stripe: options.stripe ?? unconfiguredStripe(),
    log,
    errors,
    testing: true,
  })
  const app = createApp(deps)
  const request = (path: string, init?: RequestInit) =>
    Promise.resolve(app.fetch(new Request(new URL(path, TEST_WEB_ORIGIN), init)))

  const client = (headers?: HeadersLike) =>
    createORPCClient<ContractRouterClient<Contract>>(
      new RPCLink({
        url: `${TEST_WEB_ORIGIN}/api/rpc`,
        headers: () => Object.fromEntries(withOrigin(headers).entries()),
        fetch: async (req) => app.fetch(req as Request),
      }),
    )

  const linkFor = (email: string) => {
    const mail = sent.findLast((m) => [m.to].flat().includes(email))
    const link = mail?.text.match(/https?:\/\/\S+/)?.[0]
    if (!link) throw new Error(`no link was sent to ${email}`)
    return link
  }

  return {
    app,
    deps,
    data,
    sent,
    logs,
    /** From now on: each error-level entry logged. */
    errorLog: () => {
      const from = logs.length
      return () => logs.slice(from).filter((entry) => entry.level === 'error')
    },
    captured,
    /** A procedure context for `call(procedure, input, { context })`, as app.ts builds it. */
    context: (headers?: HeadersLike): BaseContext => ({ deps, headers: new Headers(headers), log }),
    /** Calls the app in-process at `TEST_WEB_ORIGIN + path`. */
    request,
    /** oRPC client calling the app in-process from the app's origin; pass Better Auth headers to act as someone. */
    client,
    /** The link in the last email sent to `email`. */
    linkFor,
    /** Delivers a Stripe webhook body, signed for the fake gateway unless `signature` says otherwise. */
    webhook(body: object, signature: string | null = FAKE_STRIPE_SIGNATURE) {
      return request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(signature === null ? {} : { 'stripe-signature': signature }),
        },
        body: JSON.stringify(body),
      })
    },
    /** Signs in the user with `email`, creating it verified on first use; returns session headers (cookie + trusted Origin). */
    async signIn({ email, name = '' }: { email: string; name?: string }) {
      const context = await deps.auth.$context
      const { test } = context
      const existing = await context.internalAdapter.findUserByEmail(email.toLowerCase())
      const user =
        existing?.user ??
        (await test.saveUser(test.createUser({ email, name, emailVerified: true })))
      const { headers } = await test.login({ userId: user.id })
      headers.set('origin', TEST_WEB_ORIGIN)
      return { headers, userId: user.id }
    },
    /** Signs `email` in through a real magic link (read from `sent`), opened with `userAgent`; returns the session cookie. */
    async magicLinkSignIn(email: string, userAgent?: string) {
      const asked = await request('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: TEST_WEB_ORIGIN },
        body: JSON.stringify({ email, callbackURL: `${TEST_WEB_ORIGIN}/profile` }),
      })
      if (asked.status !== 200) throw new Error(`magic link refused: ${asked.status}`)
      const link = new URL(linkFor(email))
      const opened = await request(link.pathname + link.search, {
        headers: userAgent ? { 'user-agent': userAgent } : {},
        redirect: 'manual',
      })
      const cookie = sessionCookieOf(opened)
      if (!cookie) throw new Error(`the link sent to ${email} did not sign in`)
      return cookie
    },
    close: () => data.close(),
  }
}
