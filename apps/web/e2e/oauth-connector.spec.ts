import { createHash, randomBytes } from 'node:crypto'

import { type Page, expect, test } from '@playwright/test'

import { clearMailFor, magicLinkFor } from './mailpit'
import { WEB_ORIGIN } from './origins'
import { signedInOwner } from './session'
const MCP_URL = `${WEB_ORIGIN}/api/mcp`
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

async function ownerWithOrganization(page: Page, organization: string) {
  const { email } = await signedInOwner(page, {
    who: 'connector',
    organization,
    callbackURL: `${WEB_ORIGIN}/profile`,
  })
  await clearMailFor(page.request, email)
  await page.context().clearCookies()
  return email
}

test('Claude connects by magic link and consent, then calls whoami on /api/mcp', async ({
  page,
  request,
}) => {
  const email = await ownerWithOrganization(page, 'Connector Ventures')

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
