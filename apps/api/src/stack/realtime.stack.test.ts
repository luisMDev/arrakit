import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { claimsFor, permissionsOf } from '@arrakit/auth/permissions'
import { taskTopics } from '@arrakit/db'
import { insertOrganization, rawSql } from '@arrakit/db/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { type PrivateJwk, type Stack, join, openStack, signEs256 } from '../testing/stack'

const KEYS_FILE = new URL('../../../../supabase/signing_keys.json', import.meta.url)

function freshKey(): PrivateJwk {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return privateKey.export({ format: 'jwk' }) as PrivateJwk
}

/** The stack's own signing key: what Supabase Auth would sign with. */
function stackOwnKey(): PrivateJwk & { kid: string } {
  const keys = JSON.parse(readFileSync(KEYS_FILE, 'utf8')) as Record<string, unknown>[]
  const own = keys.find((key) => typeof key.d === 'string')
  if (!own) throw new Error('supabase/signing_keys.json holds no private key')
  return own as unknown as PrivateJwk & { kid: string }
}

const lifetime = () => {
  const iat = Math.floor(Date.now() / 1000)
  return { iat, exp: iat + 600 }
}

const ownerOf = (organizationId: string, userId = randomUUID()) =>
  claimsFor({ userId, organizationId, permissions: permissionsOf('owner') })
const memberOf = (organizationId: string, userId = randomUUID()) =>
  claimsFor({ userId, organizationId, permissions: permissionsOf('member') })

describe('Realtime on the local stack', () => {
  let stack: Stack
  let a: string
  let b: string

  beforeAll(async () => {
    stack = await openStack()
    a = (await insertOrganization(stack.data, { slug: `stack-${randomUUID()}` })).id
    b = (await insertOrganization(stack.data, { slug: `stack-${randomUUID()}` })).id
  })
  afterAll(async () => {
    await rawSql(stack.data)('delete from organizations where id = any($1)', [[a, b]])
    await stack.close()
  })

  const joinWith = async (token: string | undefined, topic: string) =>
    (await join(stack.client(token), topic)).status

  it('accepts a token Better Auth signs, for the topic its claims allow', async () => {
    expect(await joinWith(await stack.tokenFor(ownerOf(a)), taskTopics.organization(a))).toBe(
      'SUBSCRIBED',
    )
    const member = memberOf(a)
    expect(await joinWith(await stack.tokenFor(member), taskTopics.requester(a, member.sub))).toBe(
      'SUBSCRIBED',
    )
  }, 60_000)

  it('delivers a task change once it commits, to its organization only', async () => {
    const inA = await join(
      stack.client(await stack.tokenFor(ownerOf(a))),
      taskTopics.organization(a),
    )
    const inB = await join(
      stack.client(await stack.tokenFor(ownerOf(b))),
      taskTopics.organization(b),
    )
    const onPublic = await join(stack.client(), taskTopics.organization(a), { private: false })
    expect([inA.status, inB.status, onPublic.status]).toEqual([
      'SUBSCRIBED',
      'SUBSCRIBED',
      'SUBSCRIBED',
    ])

    const task = await stack.data.asSystem(a).tasks.start({
      queue: 'stack-tasks',
      kind: 'stack.check',
      workspaceId: null,
      requestedBy: null,
      maxAttempts: 1,
      input: {},
    })

    await vi.waitFor(
      () => expect(inA.received).toContainEqual(expect.objectContaining({ taskId: task.id })),
      { timeout: 10_000, interval: 100 },
    )
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(inB.received).toEqual([])
    expect(onPublic.received).toEqual([])
  }, 60_000)

  it("refuses another organization's topic, another member's topic and a topic the permissions do not open", async () => {
    expect(await joinWith(await stack.tokenFor(ownerOf(b)), taskTopics.organization(a))).toBe(
      'CHANNEL_ERROR',
    )
    const member = memberOf(a)
    const token = await stack.tokenFor(member)
    expect(await joinWith(token, taskTopics.requester(a, randomUUID()))).toBe('CHANNEL_ERROR')
    expect(await joinWith(token, taskTopics.organization(a))).toBe('CHANNEL_ERROR')
  }, 60_000)

  it('refuses a token from a key the stack does not list, or forged under a listed kid', async () => {
    const claims = { ...ownerOf(a), aud: 'authenticated', ...lifetime() }
    const listedKid = (JSON.parse(stack.env.BETTER_AUTH_JWT_KEY) as { kid: string }).kid
    expect(
      await joinWith(signEs256(claims, freshKey(), randomUUID()), taskTopics.organization(a)),
    ).toBe('CHANNEL_ERROR')
    expect(
      await joinWith(signEs256(claims, freshKey(), listedKid), taskTopics.organization(a)),
    ).toBe('CHANNEL_ERROR')
  }, 60_000)

  it('refuses tokens without the organization claims', async () => {
    const topic = taskTopics.organization(a)
    const sub = randomUUID()
    const { token: mcpShaped } = await stack.deps.auth.api.signJWT({
      body: { payload: { sub, organization_id: a } },
    })
    expect(await joinWith(mcpShaped, topic)).toBe('CHANNEL_ERROR')

    const own = stackOwnKey()
    const supabaseAuthShaped = signEs256(
      {
        sub,
        role: 'authenticated',
        aud: 'authenticated',
        iss: `${stack.env.SUPABASE_URL}/auth/v1`,
        ...lifetime(),
      },
      own,
      own.kid,
    )
    expect(await joinWith(supabaseAuthShaped, topic)).toBe('CHANNEL_ERROR')
    expect(await joinWith(undefined, topic)).toBe('CHANNEL_ERROR')
  }, 60_000)
})
