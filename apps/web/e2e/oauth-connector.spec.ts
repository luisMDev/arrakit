import { createHash, randomBytes } from 'node:crypto'

import { type APIRequestContext, type Page, expect, test } from '@playwright/test'

import { WEB_ORIGIN } from './origins'
const MCP_URL = `${WEB_ORIGIN}/api/mcp`
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

const uniqueEmail = (who: string) =>
  `${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@acme.test`

async function magicLinkFor(request: APIRequestContext, email: string) {
  const outbox = `/api/dev/outbox?to=${encodeURIComponent(email)}`
  await expect
    .poll(async () => ((await (await request.get(outbox)).json()) as unknown[]).length)
    .toBeGreaterThan(0)
  const [mail] = (await (await request.get(outbox)).json()) as { text: string }[]
  const link = mail?.text.match(/https?:\/\/\S+\/api\/auth\/magic-link\/verify\S+/)?.[0]
  expect(link).toBeTruthy()
  return link!
}

async function ownerWithOrganization(page: Page, email: string, organization: string) {
  const asked = await page.request.post('/api/auth/sign-in/magic-link', {
    headers: { origin: WEB_ORIGIN },
    data: { email, callbackURL: `${WEB_ORIGIN}/profile` },
  })
  expect(asked.ok()).toBe(true)
  await page.goto(await magicLinkFor(page.request, email))
  const created = await page.request.post('/api/rpc/organizations/create', {
    headers: { origin: WEB_ORIGIN },
    data: { json: { name: organization, termsAccepted: true } },
  })
  expect(created.ok()).toBe(true)
  await page.request.delete(`/api/dev/outbox`)
  await page.context().clearCookies()
}

test('Claude connects by magic link and consent, then calls whoami on /api/mcp', async ({
  page,
  request,
}) => {
  const email = uniqueEmail('connector')
  await ownerWithOrganization(page, email, 'Connector Ventures')

  const registered = await request.post('/api/auth/oauth2/register', {
    data: {
      client_name: 'Claude',
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: 'none',
    },
  })
  expect(registered.status()).toBe(201)
  const { client_id: clientId } = (await registered.json()) as { client_id: string }

  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const authorize = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK,
    state: 'claude-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: MCP_URL,
  })

  await page.route('https://claude.ai/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'connected' }),
  )

  await page.goto(`/api/auth/oauth2/authorize?${authorize}`)
  await expect(page).toHaveURL(/\/oauth\/signin\?/)
  await expect(page).toHaveTitle('Arrakit · Sign in to connect')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in to connect Arrakit' }),
  ).toBeVisible()

  await page.getByRole('textbox', { name: 'Work email' }).fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email.' })).toBeVisible()
  const link = await magicLinkFor(page.request, email)
  expect(new URL(new URL(link).searchParams.get('callbackURL')!).pathname).toBe(
    '/api/auth/oauth2/authorize',
  )

  await page.goto(link)
  await expect(page).toHaveURL(/\/oauth\/consent\?/)
  await expect(page).toHaveTitle('Arrakit · Connect')
  await expect(page.getByRole('heading', { level: 1, name: 'Connect Claude' })).toBeVisible()
  await expect(page.getByText('Claude will act as you in Connector Ventures.')).toBeVisible()

  await page.getByRole('button', { name: 'Allow' }).click()
  await page.waitForURL((url) => url.href.startsWith(CALLBACK))
  const back = new URL(page.url())
  expect(back.searchParams.get('state')).toBe('claude-state')
  const code = back.searchParams.get('code')
  expect(code).toBeTruthy()

  const exchanged = await request.post('/api/auth/oauth2/token', {
    form: {
      grant_type: 'authorization_code',
      code: code!,
      code_verifier: verifier,
      redirect_uri: CALLBACK,
      client_id: clientId,
      resource: MCP_URL,
    },
  })
  expect(exchanged.status()).toBe(200)
  const { access_token: accessToken } = (await exchanged.json()) as { access_token: string }

  const called = await request.post('/api/mcp', {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'whoami', arguments: {} },
    },
  })
  expect(called.status()).toBe(200)
  const text = await called.text()
  const body = text.includes('data: ')
    ? JSON.parse(
        text
          .split('\n')
          .find((line) => line.startsWith('data: '))!
          .slice(6),
      )
    : JSON.parse(text)
  expect(body.result.structuredContent).toMatchObject({
    organization: { name: 'Connector Ventures', plan: 'free' },
    role: 'owner',
  })
})

test('an incomplete consent link asks nothing', async ({ page }) => {
  await page.goto('/oauth/consent?client_id=abc')
  await expect(
    page.getByRole('heading', { level: 1, name: 'This link is incomplete.' }),
  ).toBeVisible()
  await expect(page.getByRole('button')).toHaveCount(0)
})
