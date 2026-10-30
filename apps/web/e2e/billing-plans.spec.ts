import { type Page, expect, test } from '@playwright/test'

import { WEB_ORIGIN } from './origins'
const FAKE_STRIPE_SIGNATURE = 't=1,v1=fake-stripe-signature'
const RENEWAL = Date.UTC(2027, 9, 4) / 1000

const uniqueEmail = (who: string) =>
  `${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@billing.test`

async function magicLink(page: Page, email: string) {
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(email)}`)
      return ((await res.json()) as unknown[]).length
    })
    .toBeGreaterThan(0)
  const res = await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(email)}`)
  const [mail] = (await res.json()) as { text: string }[]
  const link = mail?.text.match(/https?:\/\/\S+\/api\/auth\/magic-link\/verify\S+/)?.[0]
  expect(link).toBeTruthy()
  return link!
}

async function rpc<T>(page: Page, path: string, input: unknown = null): Promise<T> {
  const res = await page.request.post(`/api/rpc/${path}`, {
    data: { json: input },
    headers: { origin: WEB_ORIGIN },
  })
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as { json: T }).json
}

async function ownerOnFree(page: Page, who: string) {
  const email = uniqueEmail(who)
  const sent = await page.request.post('/api/auth/sign-in/magic-link', {
    data: { email, callbackURL: '/app' },
    headers: { origin: WEB_ORIGIN },
  })
  expect(sent.ok(), await sent.text()).toBe(true)
  await page.goto(await magicLink(page, email))
  const organization = await rpc<{ id: string }>(page, 'organizations/create', {
    name: 'Billing Co',
    termsAccepted: true,
  })
  return { email, organizationId: organization.id }
}

async function payFor(
  page: Page,
  organizationId: string,
  lookupKey: 'pro_yearly' | 'team_yearly' | 'team_monthly',
) {
  const slug = organizationId.slice(0, 8)
  const customerId = `cus_${slug}`
  const subscriptionId = `sub_${slug}`
  const yearly = lookupKey.endsWith('yearly')
  const amount = { pro_yearly: 19_200, team_yearly: 48_000, team_monthly: 5_000 }[lookupKey]
  const res = await page.request.post('/api/webhooks/stripe', {
    headers: { 'stripe-signature': FAKE_STRIPE_SIGNATURE, 'content-type': 'application/json' },
    data: JSON.stringify({
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
            amount: { amount, currency: 'usd' },
            scheduled: null,
          },
          customer: {
            email: 'finance@billing.test',
            name: 'Billing Co SL',
            taxId: null,
            card: { brand: 'visa', last4: '4242' },
          },
          invoices: [
            {
              id: `in_${slug}`,
              created: Date.UTC(2026, 9, 4) / 1000,
              total: { amount, currency: 'usd' },
              status: 'paid',
              pdfUrl: 'https://pay.stripe.test/in_1.pdf',
            },
          ],
        },
      },
    }),
  })
  expect(res.status()).toBe(204)
  return { yearly }
}

test('a visitor picks Pro on Pricing, signs up, creates the organization and reaches Checkout', async ({
  page,
}) => {
  await page.goto('/pricing')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pricing for')
  await page.getByRole('link', { name: 'Get Pro' }).click()
  await expect(page).toHaveURL(/\/signup\?plan=pro&cycle=yearly$/)

  const email = uniqueEmail('visitor')
  await page.getByRole('textbox', { name: 'Work email' }).fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.goto(await magicLink(page, email))
  await expect(page).toHaveURL(/\/profile\?plan=pro&cycle=yearly$/)
  await page.getByRole('button', { name: 'Skip' }).click()

  await expect(page).toHaveURL(/\/app\/checkout\?plan=pro&cycle=yearly$/)
  const summary = page.getByRole('region', { name: 'Order summary' })
  await expect(summary.getByText('Subscribe to Arrakit Pro')).toBeVisible()
  await expect(summary.getByText('per year')).toBeVisible()
})

test('an admin on Free selects Team monthly and is offered yearly before Checkout', async ({
  page,
}) => {
  await ownerOnFree(page, 'free')
  await page.goto('/app/plans')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pick the plan')
  await page
    .getByRole('group', { name: 'Billing' })
    .getByRole('button', { name: 'Monthly' })
    .click()
  await page.getByRole('button', { name: 'Select Team' }).click()
  const dialog = page.getByRole('dialog', { name: 'Pay less with yearly billing' })
  await expect(dialog).toContainText('$480 a year instead of $600.')
  await dialog.getByRole('button', { name: 'Continue monthly' }).click()
  await expect(page).toHaveURL(/\/app\/checkout\?plan=team&cycle=monthly$/)
  await expect(page.getByRole('region', { name: 'Order summary' })).toContainText('per month')
})

test('a paid webhook welcomes the organization to Team, and Billing shows it', async ({ page }) => {
  const { organizationId } = await ownerOnFree(page, 'welcome')
  await payFor(page, organizationId, 'team_yearly')
  await page.goto('/app/welcome?session_id=cs_test_1')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Team')

  await page.goto('/app/billing')
  const billing = page.getByRole('region', { name: 'Billing' })
  await expect(billing.getByText('Team · yearly')).toBeVisible()
  await expect(billing.getByText('Oct 4, 2027')).toBeVisible()
  await expect(billing.getByText('Visa ending 4242')).toBeVisible()
  await expect(billing.getByRole('link', { name: 'Download' })).toBeVisible()
})

test('a paying admin switches up to Team, then cancels and keeps the plan', async ({ page }) => {
  const { organizationId } = await ownerOnFree(page, 'switch')
  await payFor(page, organizationId, 'pro_yearly')

  await page.goto('/app/plans')
  await page.getByRole('button', { name: 'Switch to Team' }).click()
  const dialog = page.getByRole('dialog', { name: 'Switch to Team, yearly' })
  await expect(dialog).toContainText('$1,200 today, for the rest of this period.')
  await dialog.getByRole('button', { name: 'Switch to Team' }).click()
  await expect(page).toHaveURL(/\/app\/billing$/)
  const billing = page.getByRole('region', { name: 'Billing' })
  await expect(billing.getByText('Team · yearly')).toBeVisible()

  await billing.getByRole('button', { name: 'Cancel', exact: true }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Cancel your plan?' })
  await confirm.getByRole('button', { name: 'Cancel plan' }).click()
  await expect(billing.getByText('Ends on')).toBeVisible()
  await billing.getByRole('button', { name: 'Keep my plan' }).click()
  await expect(billing.getByText('Renews on')).toBeVisible()
})

test('Checkout without a valid plan goes back to Plans', async ({ page }) => {
  await ownerOnFree(page, 'invalid')
  await page.goto('/app/checkout?plan=enterprise&cycle=yearly')
  await expect(page).toHaveURL(/\/app\/plans$/)
})

test('a member sees Plans without buy buttons and cannot reach Billing or Checkout', async ({
  page,
  browser,
}) => {
  const { organizationId } = await ownerOnFree(page, 'owner')
  await payFor(page, organizationId, 'pro_yearly')
  const memberEmail = uniqueEmail('member')
  await rpc(page, 'invitations/invite', { email: memberEmail, role: 'member' })

  const context = await browser.newContext({ baseURL: WEB_ORIGIN })
  const member = await context.newPage()
  try {
    await member.goto(await magicLink(member, memberEmail))
    await expect(member).toHaveURL(/\/app$/)

    await member.goto('/app/plans')
    await expect(
      member.getByText('Only an admin of your organization can change its plan.'),
    ).toBeVisible()
    await expect(member.getByRole('button', { name: /^(Select|Switch to) / })).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'Your current plan' })).toBeVisible()

    await member.goto('/app/checkout?plan=team&cycle=yearly')
    await expect(member).toHaveURL(/\/app\/plans$/)

    await member.goto('/app/billing')
    await expect(member.getByRole('heading', { name: 'Account' })).toBeVisible()
    await expect(member.getByRole('region', { name: 'Billing' })).toHaveCount(0)
  } finally {
    await context.close()
  }
})
