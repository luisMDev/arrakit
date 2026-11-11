import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'

import { MCP_SCOPE, mcpResourceURL } from '@arrakit/auth'
import { NO_SUCH_WORKSPACE } from '@arrakit/db'
import { oauthClientResources, oauthClients } from '@arrakit/db/schema'
import { insertMember } from '@arrakit/db/testing'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { NO_SUCH_FILE } from '../files/files'
import { NOT_PERMITTED } from '../orpc/context'
import { TEST_WEB_ORIGIN, type TestApp, createTestApp, sessionCookieOf } from '../testing/app'
import { createOrganization, joinAs, orgApi, sqlOf } from '../testing/people'

const TEST_MCP_URL = mcpResourceURL(TEST_WEB_ORIGIN)
const ISSUER = `${TEST_WEB_ORIGIN}/api/auth`
/** Where claude.ai takes the authorization code back. */
const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

interface ConnectorTokens {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  scope: string
}

/** A PKCE verifier and its S256 challenge (RFC 7636). */
const pkcePair = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** A JWT's payload, read without checking its signature. */
const jwtPayload = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as Record<
    string,
    unknown
  >

/** Claude's side of the MCP connector, one call per step. */
function connector(t: TestApp) {
  const steps = {
    async register() {
      const res = await t.request('/api/auth/oauth2/register', {
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
    authorize(clientId: string, challenge: string, cookie?: string) {
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: CLAUDE_CALLBACK,
        state: 'claude-state',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: TEST_MCP_URL,
      })
      return t.request(`/api/auth/oauth2/authorize?${query}`, {
        headers: cookie ? { cookie } : {},
        redirect: 'manual',
      })
    },
    consent(cookie: string, oauthQuery: string, accept: boolean) {
      return t.request('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { cookie, origin: TEST_WEB_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      })
    },
    token(body: Record<string, string>) {
      return t.request('/api/auth/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
      })
    },
    /** register, authorize with PKCE, consent, swap the code: what adding the connector does. */
    async connect(cookie: string) {
      const clientId = await steps.register()
      const pkce = pkcePair()
      const authorized = await steps.authorize(clientId, pkce.challenge, cookie)
      const consentPage = new URL(authorized.headers.get('location') ?? '')
      const consented = await steps.consent(cookie, consentPage.search.slice(1), true)
      const body = (await consented.json()) as { url?: string }
      const code = body.url ? new URL(body.url).searchParams.get('code') : null
      if (!code) throw new Error(`no code: ${consented.status} ${JSON.stringify(body)}`)
      const res = await steps.token({
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
    refresh(clientId: string, refreshToken: string) {
      return steps.token({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        resource: TEST_MCP_URL,
      })
    },
  }
  return steps
}

/** One JSON-RPC call to /api/mcp as Claude's streamable HTTP client sends it. */
function mcpCall(
  t: TestApp,
  token: string | undefined,
  method: string,
  params: Record<string, unknown> = {},
  path = '/api/mcp',
) {
  return t.request(path, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
}

async function sessionUserId(t: TestApp, cookie: string) {
  const res = await t.request('/api/auth/get-session', { headers: { cookie } })
  return ((await res.json()) as { user: { id: string } }).user.id
}

/** The JSON-RPC message answering a request, from a JSON or SSE body. */
async function rpcResult(
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

const SIGNED_PARAMS = ['sig', 'exp', 'ba_iat', 'ba_pl', 'ba_param']

describe('the OAuth 2.1 provider for the MCP connector', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  const owner = async (email: string, name: string) => {
    const cookie = await t.magicLinkSignIn(email)
    const organization = await createOrganization(t, new Headers({ cookie }), name)
    return { cookie, organization }
  }

  it('publishes authorization server metadata with PKCE and without client credentials', async () => {
    const res = await t.request('/.well-known/oauth-authorization-server/api/auth')
    expect(res.status).toBe(200)
    const metadata = (await res.json()) as Record<string, unknown>
    expect(metadata).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth2/authorize`,
      token_endpoint: `${ISSUER}/oauth2/token`,
      registration_endpoint: `${ISSUER}/oauth2/register`,
    })
    expect(metadata.code_challenge_methods_supported).toContain('S256')
    expect(metadata.grant_types_supported).toContain('refresh_token')
    expect(metadata.grant_types_supported).not.toContain('client_credentials')
  })

  it('also answers the metadata under the issuer path (RFC 8414 fallback some clients use)', async () => {
    const res = await t.request('/api/auth/.well-known/oauth-authorization-server')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { issuer: string }).issuer).toBe(ISSUER)
  })

  it('registers a public client without a session and links it to the MCP resource', async () => {
    const res = await t.request('/api/auth/oauth2/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Claude',
        redirect_uris: [CLAUDE_CALLBACK],
        token_endpoint_auth_method: 'none',
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { client_id: string; redirect_uris: string[] }
    expect(body.redirect_uris).toEqual([CLAUDE_CALLBACK])

    const clients = await t.data.db.select().from(oauthClients)
    const stored = clients.find((client) => client.clientId === body.client_id)
    expect(stored).toMatchObject({ name: 'Claude', redirectUris: [CLAUDE_CALLBACK] })
    const links = await t.data.db.select().from(oauthClientResources)
    expect(links.filter((link) => link.clientId === body.client_id)).toEqual([
      expect.objectContaining({ resourceId: TEST_MCP_URL }),
    ])
  })

  it('closes the session-to-JWT route', async () => {
    const { headers } = await t.signIn({ email: 'closed@acme.com' })
    expect((await t.request('/api/auth/token', { headers })).status).toBe(404)
  })

  it('refuses a magic link asked for without a trusted Origin', async () => {
    const res = await t.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'no-origin@acme.com', callbackURL: '/' }),
    })
    expect(res.status).toBe(403)
  })

  it('sends a signed-out person to the web sign-in page with a signed query', async () => {
    const clientId = await connector(t).register()
    const res = await connector(t).authorize(clientId, pkcePair().challenge)
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.origin + location.pathname).toBe(`${TEST_WEB_ORIGIN}/oauth/signin`)
    expect(location.searchParams.get('client_id')).toBe(clientId)
    expect(location.searchParams.get('sig')).toBeTruthy()
  })

  it('issues a JWT for the MCP resource with the organization claim, and refreshes it', async () => {
    const { cookie, organization } = await owner('lucia@ardent.vc', 'Ardent Ventures')
    const clientId = await connector(t).register()
    const pkce = pkcePair()

    const authorized = await connector(t).authorize(clientId, pkce.challenge, cookie)
    expect(authorized.status).toBe(302)
    const consentPage = new URL(authorized.headers.get('location') ?? '')
    expect(consentPage.origin + consentPage.pathname).toBe(`${TEST_WEB_ORIGIN}/oauth/consent`)
    expect(consentPage.searchParams.get('client_id')).toBe(clientId)

    const consented = await connector(t).consent(cookie, consentPage.search.slice(1), true)
    const { url } = (await consented.json()) as { url: string }
    const back = new URL(url)
    expect(back.origin + back.pathname).toBe(CLAUDE_CALLBACK)
    expect(back.searchParams.get('state')).toBe('claude-state')
    const code = back.searchParams.get('code')!

    const exchange = (verifier: string) =>
      connector(t).token({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: CLAUDE_CALLBACK,
        client_id: clientId,
        resource: TEST_MCP_URL,
      })

    const res = await exchange(pkce.verifier)
    expect(res.status).toBe(200)
    const tokens = (await res.json()) as Record<string, string>
    expect(tokens).toMatchObject({ token_type: expect.stringMatching(/bearer/i) })
    expect(tokens.refresh_token).toBeTruthy()
    expect(tokens.expires_in).toBeTruthy()
    const claims = jwtPayload(tokens.access_token!)
    expect(claims).toMatchObject({
      sub: await sessionUserId(t, cookie),
      organization_id: organization.id,
      iss: ISSUER,
    })
    expect([claims.aud].flat()).toContain(TEST_MCP_URL)

    const refreshed = await connector(t).refresh(clientId, tokens.refresh_token!)
    expect(refreshed.status).toBe(200)
    const next = (await refreshed.json()) as Record<string, string>
    expect(next.access_token).not.toBe(tokens.access_token)
    expect(jwtPayload(next.access_token!).organization_id).toBe(organization.id)
  })

  it('issues no token for a wrong PKCE verifier', async () => {
    const { cookie } = await owner('pkce@ardent.vc', 'Pkce Ventures')
    const clientId = await connector(t).register()
    const pkce = pkcePair()
    const authorized = await connector(t).authorize(clientId, pkce.challenge, cookie)
    const query = new URL(authorized.headers.get('location') ?? '').search.slice(1)
    const { url } = (await (await connector(t).consent(cookie, query, true)).json()) as {
      url: string
    }
    const res = await connector(t).token({
      grant_type: 'authorization_code',
      code: new URL(url).searchParams.get('code')!,
      code_verifier: pkcePair().verifier,
      redirect_uri: CLAUDE_CALLBACK,
      client_id: clientId,
      resource: TEST_MCP_URL,
    })
    expect(res.ok).toBe(false)
    expect(await res.json()).not.toHaveProperty('access_token')
  })

  it('refuses consent to a person with no organization; a denial goes back with access_denied', async () => {
    const cookie = await t.magicLinkSignIn('loner@ardent.vc')
    const clientId = await connector(t).register()

    const authorized = await connector(t).authorize(clientId, pkcePair().challenge, cookie)
    expect(authorized.status).toBe(302)
    const consentPage = new URL(authorized.headers.get('location') ?? '')
    expect(consentPage.pathname).toBe('/oauth/consent')
    const query = consentPage.search.slice(1)

    const accepted = (await (await connector(t).consent(cookie, query, true)).json()) as Record<
      string,
      unknown
    >
    expect(accepted.url).toBeUndefined()
    expect(accepted.error).toBe('access_denied')

    const denied = (await (await connector(t).consent(cookie, query, false)).json()) as {
      url: string
    }
    const back = new URL(denied.url)
    expect(back.origin + back.pathname).toBe(CLAUDE_CALLBACK)
    expect(back.searchParams.get('error')).toBe('access_denied')
    expect(back.searchParams.get('code')).toBeNull()
  })

  it('resumes the authorization after a magic link sign-in', async () => {
    const email = 'resume@ardent.vc'
    await owner(email, 'Resume Ventures')
    const clientId = await connector(t).register()
    const signinPage = new URL(
      (await connector(t).authorize(clientId, pkcePair().challenge)).headers.get('location') ?? '',
    )
    const resumeQuery = new URLSearchParams(signinPage.search)
    for (const name of SIGNED_PARAMS) resumeQuery.delete(name)
    const callbackURL = `${TEST_WEB_ORIGIN}/api/auth/oauth2/authorize?${resumeQuery}`

    const asked = await t.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: TEST_WEB_ORIGIN },
      body: JSON.stringify({ email, callbackURL, errorCallbackURL: `${TEST_WEB_ORIGIN}/signup` }),
    })
    expect(asked.status).toBe(200)
    const link = new URL(t.linkFor(email))
    const opened = await t.request(link.pathname + link.search, { redirect: 'manual' })
    expect(opened.status).toBe(302)
    expect(opened.headers.get('location')).toBe(callbackURL)
    const cookie = sessionCookieOf(opened)!

    const resumed = new URL(callbackURL)
    const again = await t.request(resumed.pathname + resumed.search, {
      headers: { cookie },
      redirect: 'manual',
    })
    expect(again.status).toBe(302)
    const consent = new URL(again.headers.get('location') ?? '')
    expect(consent.pathname).toBe('/oauth/consent')
    expect(consent.searchParams.get('client_id')).toBe(clientId)
  })

  it('serves its signing keys with one key row after first use', async () => {
    const res = await t.request('/api/auth/jwks')
    expect(res.status).toBe(200)
    const { keys } = (await res.json()) as { keys: { kid: string }[] }
    const { jwks } = await import('@arrakit/db/schema')
    const rows = await t.data.db.select().from(jwks)
    expect(rows).toHaveLength(1)
    expect(keys.map((key) => key.kid)).toEqual(rows.map((row) => row.id))
  })
})

const METADATA_PATH = '/.well-known/oauth-protected-resource/api/mcp'
const POINTER = `resource_metadata="${TEST_WEB_ORIGIN}${METADATA_PATH}"`

/** The RFC 6750 challenge a refused call carries, read back into its parameters. */
const challengeOf = (res: Response) => {
  const header = res.headers.get('www-authenticate') ?? ''
  expect(header).toMatch(/^Bearer /)
  expect(header).toContain(POINTER)
  return Object.fromEntries(
    [...header.matchAll(/(\w+)="([^"]*)"/g)].map(([, name, value]) => [name, value]),
  )
}

const expectRefusedToken = async (res: Response) => {
  expect(res.status).toBe(401)
  expect(challengeOf(res)).toMatchObject({ error: 'invalid_token', scope: MCP_SCOPE })
}

/** Every MCP tool and the test in this file that proves who may call it. */
const TOOL_CASES = [
  "whoami: any member of the token's organization, read-only",
  "list_workspaces: a role with workspace read, the token's organization only",
  'create_workspace: a role with workspace create; a taken name is a tool error',
  "update_workspace: a role with workspace update, the token's organization only",
  "delete_workspace: a role with workspace delete, the token's organization only; purges its files",
  "list_files: a role with file read, the token's organization only",
  'get_file_download_url: a role with file read; an unknown file is a tool error',
  "upload_file: a role with file upload; the plan's file policy is a tool error",
  'rename_file: the uploader, or a role with file update',
  'delete_file: the uploader, or a role with file delete',
  "list_tasks: the person's own tasks, or all with task read, the token's organization only",
]

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

  const connectedOrganization = async (email: string, organizationName: string) => {
    const cookie = await t.magicLinkSignIn(email)
    const userId = await sessionUserId(t, cookie)
    const organization = await createOrganization(t, new Headers({ cookie }), organizationName)
    const { clientId, tokens } = await connector(t).connect(cookie)
    return { cookie, userId, organization, clientId, tokens }
  }

  const initialize = (token: string | undefined) =>
    mcpCall(t, token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'claude-ai', version: '1.0' },
    })

  const whoami = async (token: string) => {
    const res = await mcpCall(t, token, 'tools/call', { name: 'whoami', arguments: {} })
    expect(res.status).toBe(200)
    return (await rpcResult(res)).result
  }

  it('challenges a call with no token, pointing at the metadata that names the issuer', async () => {
    const res = await initialize(undefined)
    expect(res.headers.get('content-type')).toContain('application/json')
    await expectRefusedToken(res)

    const metadata = await t.request(METADATA_PATH)
    expect(metadata.status).toBe(200)
    expect(await metadata.json()).toEqual({
      resource: TEST_MCP_URL,
      authorization_servers: [ISSUER],
      scopes_supported: [MCP_SCOPE, 'offline_access'],
      bearer_methods_supported: ['header'],
      resource_name: 'Arrakit',
    })
  })

  it.each(['Basic abc', 'Token abc', 'Bearerabc', 'Bearer', 'Bearer    ', 'Bearer a"b'])(
    'challenges an Authorization header %j',
    async (authorization) => {
      const res = await t.request('/api/mcp', {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: '{}',
      })
      await expectRefusedToken(res)
    },
  )

  it('answers a member token with its tools', async () => {
    const { tokens } = await connectedOrganization('lucia@ardent.vc', 'Ardent Ventures')
    expect(tokens.scope.split(' ')).toContain(MCP_SCOPE)
    expect(jwtPayload(tokens.access_token).scope).toContain(MCP_SCOPE)

    expect((await initialize(tokens.access_token)).status).toBe(200)
    const res = await mcpCall(t, tokens.access_token, 'tools/list')
    expect(res.status).toBe(200)
    const tools = (await rpcResult(res)).result?.tools as { name: string; title: string }[]
    expect(tools.map((tool) => tool.name)).toEqual([
      'whoami',
      'list_workspaces',
      'create_workspace',
      'update_workspace',
      'delete_workspace',
      'list_files',
      'get_file_download_url',
      'upload_file',
      'rename_file',
      'delete_file',
      'list_tasks',
    ])
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

  const callTool = async (token: string, name: string, args: Record<string, unknown> = {}) => {
    const res = await mcpCall(t, token, 'tools/call', { name, arguments: args })
    expect(res.status).toBe(200)
    return (await rpcResult(res)).result
  }

  it("lists and creates workspaces in the token's organization only", async () => {
    const { tokens, organization, userId } = await connectedOrganization(
      'ines@larch.vc',
      'Larch Ventures',
    )
    const other = await connectedOrganization('owner@pine.vc', 'Pine Ventures')
    await callTool(other.tokens.access_token, 'create_workspace', {
      name: 'Elsewhere',
      description: '',
    })

    expect((await callTool(tokens.access_token, 'list_workspaces'))?.structuredContent).toEqual({
      workspaces: [],
    })
    const created = await callTool(tokens.access_token, 'create_workspace', {
      name: ' Deals ',
      description: 'Pipeline',
    })
    expect(created?.isError).toBeFalsy()
    expect(created?.structuredContent).toMatchObject({ name: 'Deals', description: 'Pipeline' })
    expect(created?.content).toEqual([{ type: 'text', text: 'Created Deals.' }])

    const listed = await callTool(tokens.access_token, 'list_workspaces')
    expect(listed?.structuredContent).toMatchObject({ workspaces: [{ name: 'Deals' }] })
    expect(listed?.content).toEqual([{ type: 'text', text: 'Deals' }])
    const [stored] = await t.data.forOrganization(organization.id).workspaces.list()
    expect(stored?.createdBy).toBe(userId)
  })

  it('answers a taken workspace name or a blank one as a tool error', async () => {
    const { tokens } = await connectedOrganization('omar@spruce.vc', 'Spruce Ventures')
    await callTool(tokens.access_token, 'create_workspace', { name: 'Ops', description: '' })

    const taken = await callTool(tokens.access_token, 'create_workspace', {
      name: 'OPS',
      description: '',
    })
    expect(taken?.isError).toBe(true)
    expect(taken?.content).toEqual([
      { type: 'text', text: 'A workspace named OPS already exists.' },
    ])
    const blank = await callTool(tokens.access_token, 'create_workspace', {
      name: '  ',
      description: '',
    })
    expect(blank?.isError).toBe(true)
  })

  it("updates and deletes workspaces in the token's organization only", async () => {
    const { tokens, organization } = await connectedOrganization('rosa@cedar.vc', 'Cedar Ventures')
    const other = await connectedOrganization('owner@hazel.vc', 'Hazel Ventures')
    const created = await callTool(tokens.access_token, 'create_workspace', {
      name: 'Deals',
      description: '',
    })
    await callTool(tokens.access_token, 'create_workspace', { name: 'Ops', description: '' })
    const elsewhere = await callTool(other.tokens.access_token, 'create_workspace', {
      name: 'Elsewhere',
      description: '',
    })
    const id = (created?.structuredContent as { id: string }).id
    const elsewhereId = (elsewhere?.structuredContent as { id: string }).id

    const updated = await callTool(tokens.access_token, 'update_workspace', {
      id,
      name: ' Pipeline ',
      description: 'Open deals',
    })
    expect(updated?.isError).toBeFalsy()
    expect(updated?.structuredContent).toMatchObject({
      id,
      name: 'Pipeline',
      description: 'Open deals',
    })
    expect(updated?.content).toEqual([{ type: 'text', text: 'Updated Pipeline.' }])

    const taken = await callTool(tokens.access_token, 'update_workspace', {
      id,
      name: 'ops',
      description: '',
    })
    expect(taken?.isError).toBe(true)
    expect(taken?.content).toEqual([
      { type: 'text', text: 'A workspace named ops already exists.' },
    ])

    for (const [name, args] of [
      ['update_workspace', { id: elsewhereId, name: 'Taken over', description: '' }],
      ['delete_workspace', { id: elsewhereId }],
    ] as const) {
      const result = await callTool(tokens.access_token, name, args)
      expect(result?.isError).toBe(true)
      expect(result?.content).toEqual([{ type: 'text', text: NO_SUCH_WORKSPACE }])
    }
    expect(await t.data.forOrganization(other.organization.id).workspaces.list()).toMatchObject([
      { id: elsewhereId, name: 'Elsewhere' },
    ])

    const deleted = await callTool(tokens.access_token, 'delete_workspace', { id })
    expect(deleted?.isError).toBeFalsy()
    expect(deleted?.content).toEqual([
      { type: 'text', text: 'Deleted the workspace and its files.' },
    ])
    expect(t.data.jobs.sent.at(-1)).toMatchObject({
      name: 'storage-purge',
      data: { organizationId: organization.id, folder: `workspaces/${id}/` },
    })
    expect(await t.data.forOrganization(organization.id).workspaces.list()).toMatchObject([
      { name: 'Ops' },
    ])
    const again = await callTool(tokens.access_token, 'delete_workspace', { id })
    expect(again?.content).toEqual([{ type: 'text', text: NO_SUCH_WORKSPACE }])
  })

  it('answers a workspace id that is not a uuid as a tool error', async () => {
    const { tokens } = await connectedOrganization('ivan@alder.vc', 'Alder Ventures')

    for (const [name, args] of [
      ['update_workspace', { id: 'deals', name: 'Deals', description: '' }],
      ['delete_workspace', { id: 'deals' }],
    ] as const) {
      expect((await callTool(tokens.access_token, name, args))?.isError).toBe(true)
    }
  })

  it("refuses the workspace tools to a role that doesn't grant them", async () => {
    const owner = await connectedOrganization('owner@teak.vc', 'Teak Capital')
    await orgApi(t, new Headers({ cookie: owner.cookie })).post('create-role', {
      role: 'auditor',
      permission: { usage: ['read'] },
      organizationId: owner.organization.id,
    })
    const created = await callTool(owner.tokens.access_token, 'create_workspace', {
      name: 'Deals',
      description: '',
    })
    const id = (created?.structuredContent as { id: string }).id
    const auditor = await joinAs(t, owner.organization.id, 'auditor@teak.vc', 'auditor')
    const { tokens } = await connector(t).connect(auditor.headers.get('cookie')!)

    for (const [name, args] of [
      ['list_workspaces', {}],
      ['create_workspace', { name: 'Audit', description: '' }],
      ['update_workspace', { id, name: 'Audit', description: '' }],
      ['delete_workspace', { id }],
    ] as const) {
      const result = await callTool(tokens.access_token, name, args)
      expect(result?.isError).toBe(true)
      expect(result?.content).toEqual([{ type: 'text', text: NOT_PERMITTED }])
    }
    expect(await t.data.forOrganization(owner.organization.id).workspaces.list()).toMatchObject([
      { id, name: 'Deals' },
    ])
  })

  it('lets a member list and create workspaces but not update or delete them', async () => {
    const owner = await connectedOrganization('owner@maple.vc', 'Maple Capital')
    const created = await callTool(owner.tokens.access_token, 'create_workspace', {
      name: 'Deals',
      description: '',
    })
    const id = (created?.structuredContent as { id: string }).id
    const member = await joinAs(t, owner.organization.id, 'member@maple.vc', 'member')
    const { tokens } = await connector(t).connect(member.headers.get('cookie')!)

    expect((await callTool(tokens.access_token, 'list_workspaces'))?.isError).toBeFalsy()
    expect(
      (await callTool(tokens.access_token, 'create_workspace', { name: 'Ops', description: '' }))
        ?.isError,
    ).toBeFalsy()
    for (const [name, args] of [
      ['update_workspace', { id, name: 'Renamed', description: '' }],
      ['delete_workspace', { id }],
    ] as const) {
      const result = await callTool(tokens.access_token, name, args)
      expect(result?.isError).toBe(true)
      expect(result?.content).toEqual([{ type: 'text', text: NOT_PERMITTED }])
    }
    expect(await t.data.forOrganization(owner.organization.id).workspaces.list()).toMatchObject([
      { id, name: 'Deals' },
      { name: 'Ops' },
    ])
  })

  const base64 = (text: string) => Buffer.from(text).toString('base64')

  it("uploads, lists, links, renames and deletes files in the token's organization", async () => {
    const { tokens, organization } = await connectedOrganization('uma@poplar.vc', 'Poplar Ventures')
    const other = await connectedOrganization('owner@aspen.vc', 'Aspen Ventures')
    const workspace = await callTool(tokens.access_token, 'create_workspace', {
      name: 'Deals',
      description: '',
    })
    const workspaceId = (workspace?.structuredContent as { id: string }).id

    const uploaded = await callTool(tokens.access_token, 'upload_file', {
      name: 'notes.md',
      contentBase64: base64('# Notes'),
    })
    expect(uploaded?.isError).toBeFalsy()
    expect(uploaded?.structuredContent).toMatchObject({
      name: 'notes.md',
      contentType: 'text/markdown',
      sizeBytes: 7,
      workspaceId: null,
    })
    const id = (uploaded?.structuredContent as { id: string }).id
    const stored = t.data.storage.objects.get(`${organization.id}/files/${id}`)
    expect(new TextDecoder().decode(stored?.bytes)).toBe('# Notes')

    await callTool(tokens.access_token, 'upload_file', {
      workspaceId,
      name: 'deal.txt',
      contentBase64: base64('deal'),
    })
    expect((await callTool(tokens.access_token, 'list_files'))?.content).toEqual([
      { type: 'text', text: 'notes.md' },
    ])
    expect(
      (await callTool(tokens.access_token, 'list_files', { workspaceId }))?.structuredContent,
    ).toMatchObject({ files: [{ name: 'deal.txt', workspaceId }] })

    const link = await callTool(tokens.access_token, 'get_file_download_url', { id })
    expect((link?.structuredContent as { url: string }).url).toContain(`files/${id}`)

    const renamed = await callTool(tokens.access_token, 'rename_file', { id, name: 'minutes.md' })
    expect(renamed?.structuredContent).toMatchObject({ id, name: 'minutes.md' })

    for (const [name, args] of [
      ['get_file_download_url', { id }],
      ['rename_file', { id, name: 'taken.md' }],
      ['delete_file', { id }],
    ] as const) {
      const result = await callTool(other.tokens.access_token, name, args)
      expect(result?.isError).toBe(true)
      expect(result?.content).toEqual([{ type: 'text', text: NO_SUCH_FILE }])
    }

    const deleted = await callTool(tokens.access_token, 'delete_file', { id })
    expect(deleted?.content).toEqual([{ type: 'text', text: 'Deleted the file.' }])
    expect(t.data.storage.objects.has(`${organization.id}/files/${id}`)).toBe(false)
  })

  it("answers what the plan's file policy refuses as a tool error", async () => {
    const { tokens } = await connectedOrganization('vera@rowan.vc', 'Rowan Ventures')
    const refused = await callTool(tokens.access_token, 'upload_file', {
      name: 'run.exe',
      contentBase64: base64('MZ'),
    })
    expect(refused?.isError).toBe(true)
    expect((refused?.content as { text: string }[])[0]?.text).toMatch(/^Files like run.exe cannot/)
  })

  it('lets a member upload and delete their own files but not delete another person’s', async () => {
    const owner = await connectedOrganization('owner@sumac.vc', 'Sumac Capital')
    const ownersFile = await callTool(owner.tokens.access_token, 'upload_file', {
      name: 'board.pdf',
      contentBase64: base64('%PDF'),
    })
    const ownersId = (ownersFile?.structuredContent as { id: string }).id
    const member = await joinAs(t, owner.organization.id, 'member@sumac.vc', 'member')
    const { tokens } = await connector(t).connect(member.headers.get('cookie')!)

    const mine = await callTool(tokens.access_token, 'upload_file', {
      name: 'mine.txt',
      contentBase64: base64('mine'),
    })
    const mineId = (mine?.structuredContent as { id: string }).id
    for (const [name, args] of [
      ['rename_file', { id: ownersId, name: 'mine.pdf' }],
      ['delete_file', { id: ownersId }],
    ] as const) {
      const result = await callTool(tokens.access_token, name, args)
      expect(result?.content).toEqual([{ type: 'text', text: NOT_PERMITTED }])
    }
    expect(
      (await callTool(tokens.access_token, 'delete_file', { id: mineId }))?.isError,
    ).toBeFalsy()
  })

  it("lists the tasks the person may see, in the token's organization only", async () => {
    const { tokens, organization, userId } = await connectedOrganization(
      'tomas@rowan.vc',
      'Rowan Ventures',
    )
    const other = await connectedOrganization('owner@aspen.vc', 'Aspen Ventures')
    const start = (organizationId: string, requestedBy: string | null, label: string) =>
      t.data.forOrganization(organizationId).tasks.start({
        queue: 'test-export',
        kind: 'workspace.export',
        workspaceId: null,
        requestedBy,
        maxAttempts: 1,
        label,
        input: {},
      })
    const mine = await start(organization.id, userId, 'Deals')
    await start(organization.id, null, 'Nobody')
    await start(other.organization.id, other.userId, 'Elsewhere')
    const tasks = t.data.forOrganization(organization.id).tasks
    await tasks.begin(mine.id, 0)
    await tasks.progress(mine.id, 1, 4)

    const listed = await callTool(tokens.access_token, 'list_tasks')
    expect(listed?.isError).toBeFalsy()
    expect(
      (listed?.structuredContent as { tasks: { label: string }[] }).tasks.map((t) => t.label),
    ).toEqual(['Nobody', 'Deals'])
    expect(listed?.content).toEqual([
      {
        type: 'text',
        text: 'workspace.export (Nobody): queued\nworkspace.export (Deals): running 1/4',
      },
    ])
    expect(
      (await callTool(tokens.access_token, 'list_tasks', { status: 'finished' }))?.content,
    ).toEqual([{ type: 'text', text: 'No tasks.' }])
  })

  it('challenges a token in the URL instead of the header', async () => {
    const { tokens } = await connectedOrganization('query@ardent.vc', 'Query Ventures')
    const res = await mcpCall(
      t,
      undefined,
      'tools/list',
      {},
      `/api/mcp?access_token=${encodeURIComponent(tokens.access_token)}`,
    )
    await expectRefusedToken(res)
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
      await expectRefusedToken(await mcpCall(t, await token(), 'tools/list'))
    })

    it.each([
      ['no scope', undefined],
      ['only the OpenID scopes', 'openid profile email offline_access'],
    ])(
      `refuses a token with %s with 403 insufficient_scope, naming ${MCP_SCOPE}`,
      async (_, scope) => {
        const res = await mcpCall(t, await signedHere({ scope }), 'tools/list')
        expect(res.status).toBe(403)
        expect(challengeOf(res)).toMatchObject({ error: 'insufficient_scope', scope: MCP_SCOPE })
        expect(await res.json()).toMatchObject({ error: 'insufficient_scope' })
      },
    )

    it(`answers a token signed here that carries ${MCP_SCOPE}`, async () => {
      const res = await mcpCall(t, await signedHere({ scope: `openid ${MCP_SCOPE}` }), 'tools/list')
      expect(res.status).toBe(200)
    })

    it('challenges a token once it has expired', async () => {
      const { tokens } = await connectedOrganization('expiring@ardent.vc', 'Expiring Org')
      expect((await mcpCall(t, tokens.access_token, 'tools/list')).status).toBe(200)

      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000)

      expect((await mcpCall(t, tokens.access_token, 'tools/list')).status).toBe(401)
    })
  })

  it("stops a removed member's tokens, refreshed ones too, and revokes their refresh token", async () => {
    const owner = await connectedOrganization('owner@elm.vc', 'Elm Capital')
    const other = await connectedOrganization('owner@yew.vc', 'Yew Capital')
    const memberCookie = await t.magicLinkSignIn('member@elm.vc')
    const memberId = await sessionUserId(t, memberCookie)
    await insertMember(t.data, owner.organization.id, memberId, 'member')
    const { clientId, tokens } = await connector(t).connect(memberCookie)
    const refreshed = await connector(t).refresh(clientId, tokens.refresh_token)
    expect(refreshed.status).toBe(200)
    const refreshedTokens = (await refreshed.json()) as typeof tokens
    expect((await whoami(tokens.access_token))?.structuredContent).toMatchObject({ role: 'member' })

    await sqlOf(t)('delete from members where user_id = $1', [memberId])
    await t.data.revokeGrants(owner.organization.id, memberId)

    for (const token of [tokens.access_token, refreshedTokens.access_token]) {
      const res = await mcpCall(t, token, 'tools/call', { name: 'whoami', arguments: {} })
      expect(res.status).toBe(401)
    }
    expect((await whoami(owner.tokens.access_token))?.isError).toBeFalsy()
    expect((await connector(t).refresh(clientId, refreshedTokens.refresh_token)).status).toBe(400)
    expect((await connector(t).refresh(owner.clientId, owner.tokens.refresh_token)).status).toBe(
      200,
    )
    expect((await connector(t).refresh(other.clientId, other.tokens.refresh_token)).status).toBe(
      200,
    )
  })

  it('revokes the grants of a deleted organization: its refresh token mints nothing', async () => {
    const owner = await connectedOrganization('owner@ash.vc', 'Ash Capital')
    const other = await connectedOrganization('owner@oak.vc', 'Oak Capital')

    const deleted = await orgApi(t, new Headers({ cookie: owner.cookie })).post('delete', {
      organizationId: owner.organization.id,
    })
    expect(deleted.status).toBe(200)

    expect((await mcpCall(t, owner.tokens.access_token, 'tools/list')).status).toBe(401)
    expect((await connector(t).refresh(owner.clientId, owner.tokens.refresh_token)).status).toBe(
      400,
    )
    expect((await connector(t).refresh(other.clientId, other.tokens.refresh_token)).status).toBe(
      200,
    )
  })

  it('binds a grant to the organization active at consent, and keeps it there after a switch', async () => {
    const first = await connectedOrganization('two@orgs.vc', 'First Orgs')
    const second = await createOrganization(t, new Headers({ cookie: first.cookie }), 'Second Orgs')
    const { tokens } = await connector(t).connect(first.cookie)
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
    await insertMember(t.data, owner.organization.id, await sessionUserId(t, cookie), 'member')
    const { tokens } = await connector(t).connect(cookie)
    expect((await whoami(tokens.access_token))?.isError).toBeFalsy()

    const left = await orgApi(t, new Headers({ cookie })).post('leave', {
      organizationId: owner.organization.id,
    })
    expect(left.status).toBe(200)
    expect((await mcpCall(t, tokens.access_token, 'tools/list')).status).toBe(401)
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

    const res = await mcpCall(t, tokens.access_token, 'tools/list')

    expect(res.status).toBe(500)
    expect(res.headers.get('www-authenticate')).toBeNull()
  })
})
