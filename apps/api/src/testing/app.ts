import { createHash, randomBytes } from 'node:crypto'

import { mcpResourceURL } from '@arrakit/auth'
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
import { createOutbox, recordingMailer } from '../mail/mailer'
import { buildDeps } from '../services'

type HeadersLike = ConstructorParameters<typeof Headers>[0]

export const TEST_WEB_ORIGIN = 'http://localhost:4200'
export const TEST_MCP_URL = mcpResourceURL(TEST_WEB_ORIGIN)
/** Where claude.ai takes the authorization code back. */
export const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

export interface ConnectorTokens {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  scope: string
}

/** A PKCE verifier and its S256 challenge (RFC 7636). */
export const pkcePair = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** A JWT's payload, read without checking its signature. */
export const jwtPayload = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as Record<
    string,
    unknown
  >

/** The `name=value` of the session cookie a response sets, if any. */
export const sessionCookieOf = (res: Response): string | undefined =>
  res.headers
    .getSetCookie()
    .find((cookie) => /session_token=[^;]+/.test(cookie))
    ?.split(';')[0]

export interface TestApp {
  app: App
  deps: AppDeps
  data: TestData
  sent: Mail[]
  /** Calls the app in-process at `TEST_WEB_ORIGIN + path`. */
  request(path: string, init?: RequestInit): Promise<Response>
  /** oRPC client calling the app in-process; pass Better Auth headers to act as someone. */
  client(headers?: HeadersLike): ContractRouterClient<Contract>
  /** Signs in the user with `email`, creating it verified on first use; returns session headers (cookie + trusted Origin). */
  signIn(user: { email: string; name?: string }): Promise<{ headers: Headers; userId: string }>
  /** Signs `email` in through a real magic link (read from `sent`); returns the session cookie. */
  magicLinkSignIn(email: string): Promise<string>
  /** The link in the last email sent to `email`. */
  linkFor(email: string): string
  /** Claude's side of the MCP connector, one call per step. */
  connector: {
    register(): Promise<string>
    authorize(clientId: string, challenge: string, cookie?: string): Promise<Response>
    consent(cookie: string, oauthQuery: string, accept: boolean): Promise<Response>
    token(body: Record<string, string>): Promise<Response>
    /** register, authorize with PKCE, consent, swap the code: what adding the connector does. */
    connect(cookie: string): Promise<{ clientId: string; tokens: ConnectorTokens }>
    refresh(clientId: string, refreshToken: string): Promise<Response>
  }
  /** One JSON-RPC call to /api/mcp as Claude's streamable HTTP client sends it. */
  mcp(
    token: string | undefined,
    method: string,
    params?: Record<string, unknown>,
    path?: string,
  ): Promise<Response>
  close(): Promise<void>
}

/** The JSON-RPC message answering a request, from a JSON or SSE body. */
export async function rpcResult(
  res: Response,
): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const text = await res.text()
  if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    return JSON.parse(text) as { result?: Record<string, unknown> }
  }
  const messages = text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>)
  return messages.find((message) => 'id' in message) ?? {}
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
  const recording = recordingMailer()
  const sent = recording.sent
  const outbox = createOutbox()
  const mailer = {
    async send(mail: Mail) {
      await recording.mailer.send(mail)
      outbox.entries.push({
        ...mail,
        from: mail.from ?? 'Arrakit <hello@example.com>',
        at: new Date().toISOString(),
      })
    },
  }
  const deps = buildDeps({
    env: loadApiEnv(rawEnv),
    rawEnv,
    data,
    mailer,
    outbox,
    stripe: options.stripe ?? null,
    testing: true,
  })
  const app = createApp(deps)
  const request = (path: string, init?: RequestInit) =>
    Promise.resolve(app.fetch(new Request(new URL(path, TEST_WEB_ORIGIN), init)))

  const client = (headers?: HeadersLike) =>
    createORPCClient<ContractRouterClient<Contract>>(
      new RPCLink({
        url: `${TEST_WEB_ORIGIN}/api/rpc`,
        headers: () => Object.fromEntries(new Headers(headers).entries()),
        fetch: async (req) => app.fetch(req as Request),
      }),
    )

  const linkFor = (email: string) => {
    const mail = sent.findLast((m) => [m.to].flat().includes(email))
    const link = mail?.text.match(/https?:\/\/\S+/)?.[0]
    if (!link) throw new Error(`no link was sent to ${email}`)
    return link
  }

  const connector: TestApp['connector'] = {
    async register() {
      const res = await request('/api/auth/oauth2/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Claude',
          redirect_uris: [CLAUDE_CALLBACK],
          token_endpoint_auth_method: 'none',
        }),
      })
      if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`)
      return ((await res.json()) as { client_id: string }).client_id
    },
    authorize(clientId, challenge, cookie) {
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: CLAUDE_CALLBACK,
        state: 'claude-state',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: TEST_MCP_URL,
      })
      return request(`/api/auth/oauth2/authorize?${query}`, {
        headers: cookie ? { cookie } : {},
        redirect: 'manual',
      })
    },
    consent(cookie, oauthQuery, accept) {
      return request('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { cookie, origin: TEST_WEB_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      })
    },
    token(body) {
      return request('/api/auth/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
      })
    },
    async connect(cookie) {
      const clientId = await connector.register()
      const pkce = pkcePair()
      const authorized = await connector.authorize(clientId, pkce.challenge, cookie)
      const consentPage = new URL(authorized.headers.get('location') ?? '')
      const consented = await connector.consent(cookie, consentPage.search.slice(1), true)
      const body = (await consented.json()) as { url?: string }
      const code = body.url ? new URL(body.url).searchParams.get('code') : null
      if (!code) throw new Error(`no code: ${consented.status} ${JSON.stringify(body)}`)
      const res = await connector.token({
        grant_type: 'authorization_code',
        code,
        code_verifier: pkce.verifier,
        redirect_uri: CLAUDE_CALLBACK,
        client_id: clientId,
        resource: TEST_MCP_URL,
      })
      if (res.status !== 200) throw new Error(`token failed: ${res.status} ${await res.text()}`)
      return { clientId, tokens: (await res.json()) as ConnectorTokens }
    },
    refresh(clientId, refreshToken) {
      return connector.token({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        resource: TEST_MCP_URL,
      })
    },
  }

  return {
    app,
    deps,
    data,
    sent,
    request,
    client,
    linkFor,
    connector,
    async signIn({ email, name = '' }) {
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
    async magicLinkSignIn(email) {
      const asked = await request('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: TEST_WEB_ORIGIN },
        body: JSON.stringify({ email, callbackURL: `${TEST_WEB_ORIGIN}/profile` }),
      })
      if (asked.status !== 200) throw new Error(`magic link refused: ${asked.status}`)
      const link = new URL(linkFor(email))
      const opened = await request(link.pathname + link.search, { redirect: 'manual' })
      const cookie = sessionCookieOf(opened)
      if (!cookie) throw new Error(`the link sent to ${email} did not sign in`)
      return cookie
    },
    mcp(token, method, params = {}, path = '/api/mcp') {
      return request(path, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
    },
    close: () => data.close(),
  }
}
