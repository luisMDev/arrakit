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

/** Signs a new person in on `page` and creates their organization; they are its owner. */
export async function signedInOwner(
  page: Page,
  {
    who = 'owner',
    organization = 'Acme',
    personName,
    callbackURL,
  }: { who?: string; organization?: string; personName?: string; callbackURL?: string } = {},
) {
  const email = uniqueEmail(who)
  await signIn(page, email, callbackURL)
  const { id } = await createOrganization(page, organization, personName)
  return { email, organizationId: id }
}

type LookupKey = 'pro_monthly' | 'pro_yearly' | 'team_monthly' | 'team_yearly'

const PRICE_CENTS: Record<LookupKey, number> = {
  pro_monthly: 2_000,
  pro_yearly: 19_200,
  team_monthly: 5_000,
  team_yearly: 48_000,
}

export const RENEWAL = Date.UTC(2027, 9, 4) / 1000

/**
 * Subscribes the organization to `lookupKey` through the fake Stripe webhook, paid with a Visa
 * ending 4242, and waits until the person on `page` sees the new plan.
 */
export async function payFor(
  page: Page,
  organizationId: string,
  lookupKey: LookupKey,
  { billingEmail = 'finance@billing.test', invoiceTo = 'Billing Co SL' } = {},
) {
  const slug = organizationId.slice(0, 8)
  const customerId = `cus_${slug}`
  const subscriptionId = `sub_${slug}`
  const amount = { amount: PRICE_CENTS[lookupKey], currency: 'usd' }
  await stripeWebhook(page, {
    subscriptionId,
    organizationId,
    subscribe: { id: subscriptionId, customerId, organizationId, status: 'active', lookupKey },
    bill: {
      customerId,
      snapshot: {
        subscription: {
          status: 'active',
          lookupKey,
          periodEnd: RENEWAL,
          cancelAtPeriodEnd: false,
          amount,
          scheduled: null,
        },
        customer: {
          email: billingEmail,
          name: invoiceTo,
          taxId: null,
          card: { brand: 'visa', last4: '4242' },
        },
        invoices: [
          {
            id: `in_${slug}`,
            created: Date.UTC(2026, 9, 4) / 1000,
            total: amount,
            status: 'paid',
            pdfUrl: 'https://pay.stripe.test/in_1.pdf',
          },
        ],
      },
    },
  })
  const plan = lookupKey.split('_')[0]
  await expect.poll(async () => (await rpc<{ plan: string }>(page, 'me/get')).plan).toBe(plan)
}
