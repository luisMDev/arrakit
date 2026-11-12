import { createPrivateKey, sign } from 'node:crypto'

import { loadAuthConfig, signSupabaseToken } from '@arrakit/auth'
import type { MemberClaims } from '@arrakit/auth/permissions'
import { TASK_SIGNAL_EVENT, loadDataConfig, openData } from '@arrakit/db'
import { memoryJobs, stackEnv } from '@arrakit/db/testing'
import { type SupabaseClient, createClient } from '@supabase/supabase-js'

import { unconfiguredStripe } from '../billing/stripe-gateway'
import { loadApiEnv } from '../env'
import { recordingMailer } from '../mail/mailer'
import { recordingErrorReporter } from '../observability/error-reporter'
import { recordingLogger } from '../observability/logger'
import { buildDeps } from '../services'
import { TEST_WEB_ORIGIN } from './app'

export type Stack = Awaited<ReturnType<typeof openStack>>

/**
 * The API's dependencies on the running local stack (`pnpm test:stack`): Postgres through the
 * pooler, Supabase Storage and Better Auth signing with the key the stack lists. Jobs stay in
 * memory. Remember `await stack.close()`.
 */
export async function openStack() {
  const env = stackEnv()
  const rawEnv = {
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'stack-secret-stack-secret-stack-secret-00',
    BETTER_AUTH_URL: TEST_WEB_ORIGIN,
    WEB_URL: TEST_WEB_ORIGIN,
    ...env,
  }
  const { log } = recordingLogger()
  const data = await openData(loadDataConfig(rawEnv), { jobs: memoryJobs(), log })
  const { mailer } = recordingMailer()
  const { errors } = recordingErrorReporter()
  const deps = buildDeps({
    env: loadApiEnv(rawEnv),
    authConfig: loadAuthConfig(rawEnv),
    data,
    mailer,
    stripe: unconfiguredStripe(),
    log,
    errors,
    testing: true,
  })
  const clients: SupabaseClient[] = []

  return {
    data,
    deps,
    env,
    /** A token Better Auth signs for `claims`, as `realtime.access` hands it to the browser. */
    tokenFor: async (claims: MemberClaims) => (await signSupabaseToken(deps.auth, claims)).token,
    /** A Supabase client with the publishable key, and `token` as its access token when given. */
    client(token?: string): SupabaseClient {
      const client = createClient(
        env.SUPABASE_URL,
        env.SUPABASE_PUBLISHABLE_KEY,
        token ? { accessToken: async () => token } : {},
      )
      clients.push(client)
      return client
    },
    async close() {
      for (const client of clients) {
        await client.removeAllChannels()
        client.realtime.disconnect()
      }
      await data.close()
    },
  }
}

export type JoinStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'

/**
 * Joins `topic` and answers the first status Realtime reports, with the task signals the channel
 * receives from then on. A channel that did not subscribe is removed.
 */
export async function join(
  client: SupabaseClient,
  topic: string,
  { private: isPrivate = true }: { private?: boolean } = {},
): Promise<{ status: JoinStatus; received: unknown[] }> {
  await client.realtime.setAuth()
  const received: unknown[] = []
  const channel = client
    .channel(topic, { config: { private: isPrivate } })
    .on('broadcast', { event: TASK_SIGNAL_EVENT }, ({ payload }) => received.push(payload))
  const status = await new Promise<JoinStatus>((resolve) =>
    channel.subscribe((state) => resolve(`${state}` as JoinStatus)),
  )
  if (status !== 'SUBSCRIBED') await client.removeChannel(channel)
  return { status, received }
}

/** A private P-256 JWK; only these members matter to node:crypto. */
export interface PrivateJwk {
  kty: string
  crv: string
  x: string
  y: string
  d: string
}

/** A compact ES256 JWT over `claims`, signed with `privateJwk` under `kid`. */
export function signEs256(claims: object, privateJwk: PrivateJwk, kid: string): string {
  const { kty, crv, x, y, d } = privateJwk
  const key = createPrivateKey({ key: { kty, crv, x, y, d }, format: 'jwk' })
  const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url')
  const data = `${encode({ alg: 'ES256', typ: 'JWT', kid })}.${encode(claims)}`
  const signature = sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' })
  return `${data}.${signature.toString('base64url')}`
}
