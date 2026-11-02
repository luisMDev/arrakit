import { type BillingCycle, PLAN_OFFERS, type PaidPlan } from '@arrakit/plans'
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

/** Calls Better Auth's `/api/auth/<path>` as the user signed in on `page`. */
async function authApi<T>(page: Page, path: string, body: unknown): Promise<T> {
  const res = await page.request.post(`/api/auth/${path}`, {
    data: body,
    headers: { origin: WEB_ORIGIN },
  })
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json()) as T
}

/** Creates the person's organization as the profile step does; it becomes the active one. */
async function createOrganization(page: Page, name: string, personName?: string) {
  if (personName) await authApi(page, 'update-user', { name: personName })
  return authApi<{ id: string }>(page, 'organization/create', {
    name,
    slug: 'pending',
    termsAccepted: true,
  })
}

export const inviteMember = (page: Page, organizationId: string, email: string, role = 'member') =>
  authApi<{ id: string }>(page, 'organization/invite-member', { email, role, organizationId })

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

const RENEWAL = Date.UTC(2027, 9, 4) / 1000

/**
 * Subscribes the organization to `lookupKey` through the fake Stripe webhook, paid with a Visa
 * ending 4242, and waits until the person on `page` sees the new plan.
 */
export async function payFor(
  page: Page,
  organizationId: string,
  lookupKey: `${PaidPlan}_${BillingCycle}`,
  { billingEmail = 'finance@billing.test', invoiceTo = 'Billing Co SL' } = {},
) {
  const [plan, cycle] = lookupKey.split('_') as [PaidPlan, BillingCycle]
  const slug = organizationId.slice(0, 8)
  const customerId = `cus_${slug}`
  const subscriptionId = `sub_${slug}`
  const amount = { amount: PLAN_OFFERS[plan][`${cycle}Cents`], currency: 'usd' }
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
  await expect.poll(async () => (await rpc<{ plan: string }>(page, 'me/get')).plan).toBe(plan)
}
