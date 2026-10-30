import { type Page, expect } from '@playwright/test'

import { magicLinkFor } from './mailpit'
import { WEB_ORIGIN } from './origins'

const FAKE_STRIPE_SIGNATURE = 't=1,v1=fake-stripe-signature'

export const uniqueEmail = (who: string) =>
  `${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@acme.test`

/** Calls an oRPC procedure as the user signed in on `page` and returns its output. */
export async function rpc<T>(page: Page, path: string, input: unknown = null): Promise<T> {
  const res = await page.request.post(`/api/rpc/${path}`, {
    data: { json: input },
    headers: { origin: WEB_ORIGIN },
  })
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as { json: T }).json
}

/** Signs `email` in on `page` through the magic link the API mails. */
export async function signIn(page: Page, email: string, callbackURL = '/app') {
  const sent = await page.request.post('/api/auth/sign-in/magic-link', {
    data: { email, callbackURL },
    headers: { origin: WEB_ORIGIN },
  })
  expect(sent.ok(), await sent.text()).toBe(true)
  await page.goto(await magicLinkFor(page.request, email))
}

export const createOrganization = (page: Page, name: string, personName?: string) =>
  rpc<{ id: string }>(page, 'organizations/create', { name, personName, termsAccepted: true })

/** Posts `body` to the Stripe webhook as the API's fake gateway signs it. */
export async function stripeWebhook(page: Page, body: unknown) {
  const res = await page.request.post('/api/webhooks/stripe', {
    headers: { 'stripe-signature': FAKE_STRIPE_SIGNATURE, 'content-type': 'application/json' },
    data: JSON.stringify(body),
  })
  expect(res.status(), await res.text()).toBe(204)
}
