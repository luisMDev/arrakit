import { expect, test } from '@playwright/test'

import { WEB_ORIGIN } from './origins'

const uniqueEmail = () => `proxy-${Date.now()}-${Math.floor(Math.random() * 1e6)}@acme.test`

// The API runs with NODE_ENV=test here, where Better Auth falls back to 127.0.0.1 when no
// forwarded IP header reaches it, so x-forwarded-for cannot be told apart from that fallback.
// This checks the end-to-end path with the platform edge's x-real-ip instead (spec
// auth-onboarding section 10); the route rule's xfwd and its single-IP x-forwarded-for are
// covered against h3's rule runtime in src/lib/api-proxy.test.ts.
test('a session created through the web proxy records the client IP', async ({ page }) => {
  const email = uniqueEmail()
  const asked = await page.request.post('/api/auth/sign-in/magic-link', {
    headers: { origin: WEB_ORIGIN },
    data: { email, callbackURL: '/profile' },
  })
  expect(asked.status(), await asked.text()).toBe(200)

  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(email)}`)
      return ((await res.json()) as unknown[]).length
    })
    .toBeGreaterThan(0)
  const outbox = await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(email)}`)
  const [mail] = (await outbox.json()) as { text: string }[]
  const link = mail?.text.match(/https?:\/\/\S+\/api\/auth\/magic-link\/verify\S+/)?.[0]
  expect(link).toBeTruthy()

  const verify = await page.request.get(link!, {
    maxRedirects: 0,
    headers: { 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.9, 198.51.100.1' },
  })
  expect(verify.status()).toBe(302)

  const session = await page.request.get('/api/auth/get-session')
  const body = (await session.json()) as { session: { ipAddress?: string | null } } | null
  expect(body?.session.ipAddress).toBe('203.0.113.9')
})
