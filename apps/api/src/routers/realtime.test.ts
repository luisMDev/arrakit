import { oauthIssuer } from '@arrakit/auth'
import { claimsFor, permissionsOf } from '@arrakit/auth/permissions'
import { taskTopics } from '@arrakit/db'
import { realtimeJoinSees } from '@arrakit/db/testing'
import { verifyJwsAccessToken } from 'better-auth/oauth2'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_WEB_ORIGIN, type TestApp, createTestApp } from '../testing/app'
import { joinAs, ownerOf } from '../testing/people'

const SUPABASE = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
}

const payloadOf = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >

describe('realtime.access', () => {
  let t: TestApp
  let counter = 0

  beforeAll(async () => {
    t = await createTestApp({ env: SUPABASE })
  })
  afterAll(() => t.close())

  const organization = async () => {
    counter += 1
    const owner = await ownerOf(t, `owner${counter}@realtime.com`)
    const member = await joinAs(t, owner.organizationId, `member${counter}@realtime.com`, 'member')
    return { owner, member }
  }

  it('gives an owner the project, a ten-minute token and the organization topic', async () => {
    const { owner } = await organization()
    const before = Date.now()
    const access = (await t.client(owner.headers).realtime.access())!

    expect(access).toMatchObject({
      url: SUPABASE.SUPABASE_URL,
      publishableKey: SUPABASE.SUPABASE_PUBLISHABLE_KEY,
      topics: { tasks: taskTopics.organization(owner.organizationId) },
    })
    const lifetime = new Date(access.expiresAt).getTime() - before
    expect(lifetime).toBeGreaterThan(590_000)
    expect(lifetime).toBeLessThanOrEqual(601_000)

    const res = await t.request('/api/auth/jwks')
    const keys = (await res.json()) as Awaited<
      ReturnType<TestApp['deps']['auth']['api']['getJwks']>
    >
    await expect(
      verifyJwsAccessToken(access.token, {
        jwksFetch: async () => keys,
        jwksCacheKey: {},
        verifyOptions: { issuer: oauthIssuer(TEST_WEB_ORIGIN), audience: 'authenticated' },
      }),
    ).resolves.toMatchObject({ sub: owner.userId })

    const payload = payloadOf(access.token)
    expect(payload).toEqual({
      ...claimsFor({
        userId: owner.userId,
        organizationId: owner.organizationId,
        permissions: permissionsOf('owner'),
      }),
      aud: 'authenticated',
      iss: oauthIssuer(TEST_WEB_ORIGIN),
      iat: expect.any(Number),
      exp: (payload.iat as number) + 600,
    })
    expect(new Date(access.expiresAt).getTime()).toBe((payload.exp as number) * 1000)
  })

  it('gives a member without task read only their own topic', async () => {
    const { owner, member } = await organization()
    const access = await t.client(member.headers).realtime.access()
    expect(access!.topics.tasks).toBe(taskTopics.requester(owner.organizationId, member.userId))
  })

  it('names topics the token may join, and no other', async () => {
    const { owner, member } = await organization()
    const other = await organization()
    await t.data.asSystem(owner.organizationId).tasks.start({
      queue: 'test-export',
      kind: 'workspace.export',
      workspaceId: null,
      requestedBy: member.userId,
      maxAttempts: 3,
      input: {},
    })
    await t.data.asSystem(other.owner.organizationId).tasks.start({
      queue: 'test-export',
      kind: 'workspace.export',
      workspaceId: null,
      requestedBy: other.member.userId,
      maxAttempts: 3,
      input: {},
    })

    for (const person of [owner, member]) {
      const access = (await t.client(person.headers).realtime.access())!
      const claims = payloadOf(access.token)
      expect(await realtimeJoinSees(t.data, claims, access.topics.tasks)).toBeGreaterThan(0)
      expect(
        await realtimeJoinSees(t.data, claims, taskTopics.organization(other.owner.organizationId)),
      ).toBe(0)
      expect(
        await realtimeJoinSees(
          t.data,
          claims,
          taskTopics.requester(other.owner.organizationId, other.member.userId),
        ),
      ).toBe(0)
    }
    const ownerClaims = payloadOf((await t.client(owner.headers).realtime.access())!.token)
    expect(
      await realtimeJoinSees(
        t.data,
        ownerClaims,
        taskTopics.requester(owner.organizationId, member.userId),
      ),
    ).toBe(0)
  })

  it('refuses someone signed out, and someone with no organization', async () => {
    await expect(t.client().realtime.access()).rejects.toMatchObject({ status: 401 })
    const loner = await t.signIn({ email: 'loner@realtime.com' })
    await expect(t.client(loner.headers).realtime.access()).rejects.toMatchObject({ status: 404 })
  })
})

describe('realtime.access without a Supabase project', () => {
  let t: TestApp
  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  it('answers null', async () => {
    const owner = await ownerOf(t, 'owner@no-realtime.com')
    await expect(t.client(owner.headers).realtime.access()).resolves.toBeNull()
  })
})
