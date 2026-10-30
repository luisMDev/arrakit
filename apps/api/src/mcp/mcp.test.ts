import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'

import { insertMember } from '@arrakit/db/testing'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  TEST_MCP_URL,
  TEST_WEB_ORIGIN,
  type TestApp,
  createTestApp,
  jwtPayload,
  rpcResult,
} from '../testing/app'
import { orgApi, sqlOf } from '../testing/people'

const ISSUER = `${TEST_WEB_ORIGIN}/api/auth`
const METADATA_PATH = '/.well-known/oauth-protected-resource/api/mcp'
const CHALLENGE = `Bearer resource_metadata="${TEST_WEB_ORIGIN}${METADATA_PATH}"`

/** Every MCP tool and the test in this file that proves who may call it. */
const TOOL_CASES = ["whoami: any member of the token's organization, read-only"]

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

const signedElsewhere = (claims: Record<string, unknown>): string => {
  const { privateKey } = generateKeyPairSync('ed25519')
  const input = `${base64url({ alg: 'EdDSA', typ: 'at+jwt', kid: 'elsewhere' })}.${base64url(claims)}`
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`
}

describe('the MCP endpoint', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  afterAll(() => t.close())

  const sessionUserId = async (cookie: string) => {
    const res = await t.request('/api/auth/get-session', { headers: { cookie } })
    return ((await res.json()) as { user: { id: string } }).user.id
  }

  const connectedOrganization = async (email: string, organizationName: string) => {
    const cookie = await t.magicLinkSignIn(email)
    const userId = await sessionUserId(cookie)
    const organization = await t
      .client(new Headers({ cookie }))
      .onboarding.create({ name: organizationName, termsAccepted: true })
    const { clientId, tokens } = await t.connector.connect(cookie)
    return { cookie, userId, organization, clientId, tokens }
  }

  const initialize = (token: string | undefined) =>
    t.mcp(token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'claude-ai', version: '1.0' },
    })

  const whoami = async (token: string) => {
    const res = await t.mcp(token, 'tools/call', { name: 'whoami', arguments: {} })
    expect(res.status).toBe(200)
    return (await rpcResult(res)).result
  }

  it('challenges a call with no token, pointing at the metadata that names the issuer', async () => {
    const res = await initialize(undefined)
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(CHALLENGE)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'invalid_token' })

    const metadata = await t.request(METADATA_PATH)
    expect(metadata.status).toBe(200)
    expect(await metadata.json()).toEqual({
      resource: TEST_MCP_URL,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
      resource_name: 'Arrakit',
    })
  })

  it('answers a member token with its tools', async () => {
    const { tokens } = await connectedOrganization('lucia@ardent.vc', 'Ardent Ventures')

    expect((await initialize(tokens.access_token)).status).toBe(200)
    const res = await t.mcp(tokens.access_token, 'tools/list')
    expect(res.status).toBe(200)
    const tools = (await rpcResult(res)).result?.tools as { name: string; title: string }[]
    expect(tools.map((tool) => tool.name)).toEqual(['whoami'])
    expect(tools[0]?.title).toBe('Who am I')
    expect(tools.map((tool) => tool.name)).toEqual(TOOL_CASES.map((line) => line.split(':')[0]))
  })

  it("answers whoami with the token's organization and role", async () => {
    const { tokens, organization } = await connectedOrganization('ana@birch.vc', 'Birch Ventures')

    const result = await whoami(tokens.access_token)

    expect(result?.isError).toBeFalsy()
    expect(result?.structuredContent).toEqual({
      organization: {
        id: organization.id,
        name: 'Birch Ventures',
        slug: organization.slug,
        plan: 'free',
      },
      role: 'owner',
    })
    expect(result?.content).toEqual([{ type: 'text', text: 'Birch Ventures (owner)' }])
  })

  it('challenges a token in the URL instead of the header', async () => {
    const { tokens } = await connectedOrganization('query@ardent.vc', 'Query Ventures')
    const res = await t.mcp(
      undefined,
      'tools/list',
      {},
      `/api/mcp?access_token=${encodeURIComponent(tokens.access_token)}`,
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(CHALLENGE)
  })

  describe('a token it did not issue for this endpoint, to this member', () => {
    let claims: Record<string, unknown>
    const signedHere = async (overrides: Record<string, unknown>) => {
      const { token } = await t.deps.auth.api.signJWT({
        body: { payload: { ...claims, ...overrides } },
      })
      return token
    }

    beforeAll(async () => {
      const { tokens } = await connectedOrganization('mallory@ardent.vc', 'Mallory Organization')
      claims = jwtPayload(tokens.access_token)
    })

    it.each([
      ['garbage', async () => 'not-a-jwt'],
      ['a JWT signed with another key', async () => signedElsewhere(claims)],
      [
        'a JWT with no signature',
        async () => `${base64url({ alg: 'none' })}.${base64url(claims)}.`,
      ],
      ['a token for another resource', async () => signedHere({ aud: `${TEST_WEB_ORIGIN}/api/x` })],
      ['a token from another issuer', async () => signedHere({ iss: 'https://evil.example/api' })],
      ['a token without an organization', async () => signedHere({ organization_id: undefined })],
      [
        'a token for an organization not theirs',
        async () => signedHere({ organization_id: randomUUID() }),
      ],
    ])('challenges %s', async (_label, token) => {
      const res = await t.mcp(await token(), 'tools/list')
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toBe(`${CHALLENGE}, error="invalid_token"`)
    })

    it('challenges a token once it has expired', async () => {
      const { tokens } = await connectedOrganization('expiring@ardent.vc', 'Expiring Org')
      expect((await t.mcp(tokens.access_token, 'tools/list')).status).toBe(200)

      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000)

      expect((await t.mcp(tokens.access_token, 'tools/list')).status).toBe(401)
    })
  })

  it("stops a removed member's tokens, refreshed ones too, and revokes their refresh token", async () => {
    const owner = await connectedOrganization('owner@elm.vc', 'Elm Capital')
    const other = await connectedOrganization('owner@yew.vc', 'Yew Capital')
    const memberCookie = await t.magicLinkSignIn('member@elm.vc')
    const memberId = await sessionUserId(memberCookie)
    await insertMember(t.data, owner.organization.id, memberId, 'member')
    const { clientId, tokens } = await t.connector.connect(memberCookie)
    const refreshed = await t.connector.refresh(clientId, tokens.refresh_token)
    expect(refreshed.status).toBe(200)
    const refreshedTokens = (await refreshed.json()) as typeof tokens
    expect((await whoami(tokens.access_token))?.structuredContent).toMatchObject({ role: 'member' })

    await sqlOf(t)('delete from members where user_id = $1', [memberId])
    await t.data.revokeGrants(owner.organization.id, memberId)

    for (const token of [tokens.access_token, refreshedTokens.access_token]) {
      const res = await t.mcp(token, 'tools/call', { name: 'whoami', arguments: {} })
      expect(res.status).toBe(401)
    }
    expect((await whoami(owner.tokens.access_token))?.isError).toBeFalsy()
    expect((await t.connector.refresh(clientId, refreshedTokens.refresh_token)).status).toBe(400)
    expect((await t.connector.refresh(owner.clientId, owner.tokens.refresh_token)).status).toBe(200)
    expect((await t.connector.refresh(other.clientId, other.tokens.refresh_token)).status).toBe(200)
  })

  it('revokes the grants of a deleted organization: its refresh token mints nothing', async () => {
    const owner = await connectedOrganization('owner@ash.vc', 'Ash Capital')
    const other = await connectedOrganization('owner@oak.vc', 'Oak Capital')

    const deleted = await orgApi(t, new Headers({ cookie: owner.cookie })).post('delete', {
      organizationId: owner.organization.id,
    })
    expect(deleted.status).toBe(200)

    expect((await t.mcp(owner.tokens.access_token, 'tools/list')).status).toBe(401)
    expect((await t.connector.refresh(owner.clientId, owner.tokens.refresh_token)).status).toBe(400)
    expect((await t.connector.refresh(other.clientId, other.tokens.refresh_token)).status).toBe(200)
  })

  it('binds a grant to the organization active at consent, and keeps it there after a switch', async () => {
    const first = await connectedOrganization('two@orgs.vc', 'First Orgs')
    const api = t.client(new Headers({ cookie: first.cookie }))
    const second = await api.onboarding.create({ name: 'Second Orgs', termsAccepted: true })
    const { tokens } = await t.connector.connect(first.cookie)
    expect((await whoami(tokens.access_token))?.structuredContent).toMatchObject({
      organization: { id: second.id },
    })

    await orgApi(t, new Headers({ cookie: first.cookie })).post('set-active', {
      organizationId: first.organization.id,
    })
    expect((await whoami(tokens.access_token))?.structuredContent).toMatchObject({
      organization: { id: second.id },
    })
    expect((await whoami(first.tokens.access_token))?.structuredContent).toMatchObject({
      organization: { id: first.organization.id },
    })
  })

  it('stops a token once its person leaves that organization through Better Auth', async () => {
    const owner = await connectedOrganization('owner@leave.vc', 'Leave Capital')
    const cookie = await t.magicLinkSignIn('leaver@leave.vc')
    await insertMember(t.data, owner.organization.id, await sessionUserId(cookie), 'member')
    const { tokens } = await t.connector.connect(cookie)
    expect((await whoami(tokens.access_token))?.isError).toBeFalsy()

    const left = await orgApi(t, new Headers({ cookie })).post('leave', {
      organizationId: owner.organization.id,
    })
    expect(left.status).toBe(200)
    expect((await t.mcp(tokens.access_token, 'tools/list')).status).toBe(401)
    expect((await whoami(owner.tokens.access_token))?.isError).toBeFalsy()
  })

  it('answers a GET or DELETE with a token with 405: sessions are not served', async () => {
    const { tokens } = await connectedOrganization('get@ardent.vc', 'Get Ventures')
    for (const method of ['GET', 'DELETE']) {
      const res = await t.request('/api/mcp', {
        method,
        headers: { accept: 'text/event-stream', authorization: `Bearer ${tokens.access_token}` },
      })
      expect(res.status).toBe(405)
    }
    expect((await t.request('/api/mcp')).status).toBe(401)
  })

  it('answers 500, not a challenge, when the API cannot read its own signing keys', async () => {
    const { tokens } = await connectedOrganization('keys@ardent.vc', 'Keys Ventures')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000)
    vi.spyOn(t.deps.auth.api, 'getJwks').mockRejectedValueOnce(new Error('connection terminated'))

    const res = await t.mcp(tokens.access_token, 'tools/list')

    expect(res.status).toBe(500)
    expect(res.headers.get('www-authenticate')).toBeNull()
  })
})
